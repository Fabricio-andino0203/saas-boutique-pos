import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Bóveda de secretos de la plataforma: cifra con AES-256-GCM lo que no puede guardarse en claro pero sí hay que recuperar
 * (la contraseña de la base de cada negocio, el secreto del 2FA de cada superadministrador).
 *
 * - La llave maestra vive **fuera** de la base de datos (`PLATFORM_MASTER_KEY`). Sin ella, una copia de la base central no
 *   revela ningún secreto; y sin ella tampoco se recuperan: hay que respaldarla aparte (ver docs/RUNBOOK.md).
 * - Cada secreto se cifra con un *nonce* aleatorio propio y con un **contexto** (`tenant:<id>:db`) como dato autenticado:
 *   un texto cifrado copiado a otra fila ya no descifra.
 * - El sobre guarda la versión de la llave, para poder rotarla (`rotate`) sin parar el sistema: la llave nueva cifra, la
 *   anterior solo descifra hasta que se re-cifra todo.
 *
 * Formato del sobre: `v<versión>.<nonce>.<texto cifrado>.<etiqueta>`, cada parte en base64url.
 */

export const MASTER_KEY_BYTES = 32;
const NONCE_BYTES = 12;

export type VaultKey = { version: number; key: Buffer };

export class VaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultError";
  }
}

export type Vault = {
  /** Versión de la llave con la que se cifra hoy. */
  readonly currentVersion: number;
  encrypt(plain: string, context: string): string;
  /** Lanza `VaultError` si el sobre está dañado, es de otro contexto o su llave no está disponible. */
  decrypt(envelope: string, context: string): string;
  /** `true` si el sobre se cifró con una llave que ya no es la actual. */
  needsRotation(envelope: string): boolean;
  /** Descifra y vuelve a cifrar con la llave actual. */
  rotate(envelope: string, context: string): string;
};

/** Convierte el texto de la llave (base64 o base64url) en sus 32 bytes; lanza si no mide exactamente eso. */
export function parseMasterKey(text: string): Buffer {
  const key = Buffer.from(text.trim(), "base64");
  if (key.length !== MASTER_KEY_BYTES) {
    throw new VaultError(
      `La llave maestra debe tener ${MASTER_KEY_BYTES} bytes en base64 (tiene ${key.length})`,
    );
  }
  return key;
}

/** Llave nueva y aleatoria, lista para `PLATFORM_MASTER_KEY`. */
export function generateMasterKey(): string {
  return randomBytes(MASTER_KEY_BYTES).toString("base64url");
}

function parseEnvelope(envelope: string): {
  version: number;
  nonce: Buffer;
  data: Buffer;
  tag: Buffer;
} {
  const match = /^v(\d+)\.([\w-]+)\.([\w-]*)\.([\w-]+)$/.exec(envelope);
  if (!match) {
    throw new VaultError("Sobre cifrado con formato inválido");
  }
  const nonce = Buffer.from(match[2] as string, "base64url");
  const tag = Buffer.from(match[4] as string, "base64url");
  if (nonce.length !== NONCE_BYTES || tag.length !== 16) {
    throw new VaultError("Sobre cifrado con formato inválido");
  }
  return {
    version: Number(match[1]),
    nonce,
    data: Buffer.from(match[3] as string, "base64url"),
    tag,
  };
}

export function createVault(current: VaultKey, previous: readonly VaultKey[] = []): Vault {
  const byVersion = new Map<number, Buffer>();
  for (const entry of [current, ...previous]) {
    if (entry.key.length !== MASTER_KEY_BYTES) {
      throw new VaultError(`La llave versión ${entry.version} no mide ${MASTER_KEY_BYTES} bytes`);
    }
    if (byVersion.has(entry.version)) {
      throw new VaultError(`La versión de llave ${entry.version} está repetida`);
    }
    byVersion.set(entry.version, entry.key);
  }

  const vault: Vault = {
    currentVersion: current.version,

    encrypt(plain, context) {
      const nonce = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv("aes-256-gcm", current.key, nonce);
      cipher.setAAD(Buffer.from(context, "utf8"));
      const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return [
        `v${current.version}`,
        nonce.toString("base64url"),
        data.toString("base64url"),
        tag.toString("base64url"),
      ].join(".");
    },

    decrypt(envelope, context) {
      const parsed = parseEnvelope(envelope);
      const key = byVersion.get(parsed.version);
      if (!key) {
        throw new VaultError(`No hay una llave maestra para la versión ${parsed.version}`);
      }
      try {
        const decipher = createDecipheriv("aes-256-gcm", key, parsed.nonce);
        decipher.setAAD(Buffer.from(context, "utf8"));
        decipher.setAuthTag(parsed.tag);
        return Buffer.concat([decipher.update(parsed.data), decipher.final()]).toString("utf8");
      } catch {
        // El mensaje no distingue "llave equivocada" de "dato alterado" ni de "contexto distinto".
        throw new VaultError(
          "No se pudo descifrar el secreto (llave, contexto o datos incorrectos)",
        );
      }
    },

    needsRotation(envelope) {
      return parseEnvelope(envelope).version !== current.version;
    },

    rotate(envelope, context) {
      return vault.encrypt(vault.decrypt(envelope, context), context);
    },
  };
  return vault;
}

/** Contextos autenticados: cada tipo de secreto tiene el suyo, atado al registro al que pertenece. */
export const vaultContext = {
  tenantDatabase: (tenantId: string) => `tenant:${tenantId}:db-credential`,
  platformUserTotp: (userId: string) => `platform-user:${userId}:totp-secret`,
  /** Contraseña temporal del propietario de un negocio, solo mientras se da de alta (se borra al terminar). */
  tenantOwnerPassword: (tenantId: string) => `tenant:${tenantId}:owner-password`,
} as const;

type VaultEnv = Record<string, string | undefined>;

function versionOf(raw: string | undefined, fallback: number): number {
  const parsed = raw === undefined || raw === "" ? fallback : Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new VaultError("La versión de la llave maestra debe ser un entero positivo");
  }
  return parsed;
}

/** Arma la bóveda a partir de variables de entorno (la llave actual y, mientras se rota, la anterior). */
export function vaultFromEnvironment(source: VaultEnv): Vault {
  if (!source.PLATFORM_MASTER_KEY) {
    throw new VaultError(
      "Falta PLATFORM_MASTER_KEY: la plataforma no puede guardar ni leer secretos",
    );
  }
  const current: VaultKey = {
    version: versionOf(source.PLATFORM_MASTER_KEY_VERSION, 1),
    key: parseMasterKey(source.PLATFORM_MASTER_KEY),
  };
  const previous: VaultKey[] = [];
  if (source.PLATFORM_MASTER_KEY_PREVIOUS) {
    previous.push({
      version: versionOf(source.PLATFORM_MASTER_KEY_PREVIOUS_VERSION, current.version - 1),
      key: parseMasterKey(source.PLATFORM_MASTER_KEY_PREVIOUS),
    });
  }
  return createVault(current, previous);
}

const globalVault = globalThis as typeof globalThis & { __boutiqueVault?: Vault };

/** La bóveda del proceso (se arma una vez con el entorno). */
export function getVault(): Vault {
  return (globalVault.__boutiqueVault ??= vaultFromEnvironment(process.env));
}

/** Solo para pruebas: sustituye o limpia la bóveda del proceso. */
export function setVault(vault: Vault | undefined): void {
  globalVault.__boutiqueVault = vault;
}
