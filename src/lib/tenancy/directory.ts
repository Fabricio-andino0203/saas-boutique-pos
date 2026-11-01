import type { TenantRef } from "@/lib/tenancy/tenant-context";

/**
 * De dónde sale el negocio de una petición: **solo** del nombre de host, que se busca en un directorio de confianza (la tabla
 * `Tenant` de la base central, ver `control-directory.ts`). Nada que mande el navegador (rutas, parámetros, cuerpo, cookies)
 * puede elegir el negocio.
 *
 * Este archivo es la parte pura (tipos, normalización del host y la caché del directorio) para poder probarla sin base de datos.
 */

/** Lo mínimo de un negocio que no atiende (suspendido): sirve para el registro y para saber de quién es la pantalla. */
export type TenantSummary = { id: string; slug: string; name: string };

/**
 * Qué hay detrás de un host:
 * - `active`: el negocio opera; trae cómo conectarse a su base.
 * - `suspended`: el negocio existe pero no puede operar (suspendido o pendiente de baja). Se responde una pantalla de
 *   cuenta suspendida, sin tocar su base.
 * Un host sin negocio (o de un negocio que aún no existe del todo o ya se dio de baja) no tiene entrada: `undefined`.
 */
export type DirectoryEntry =
  { state: "active"; tenant: TenantRef } | { state: "suspended"; tenant: TenantSummary };

export type TenantDirectory = {
  /** Lanza `TenantDirectoryError` si no se puede consultar el directorio (no se sabe si el host es de un negocio). */
  lookupByHost(host: string): Promise<DirectoryEntry | undefined>;
};

/**
 * El directorio no pudo responder (base central caída, credencial que no descifra…): es distinto de "no existe".
 *
 * `transient` dice si el problema es de **alcanzar** la base central (una caída que pasará): solo entonces se puede seguir
 * sirviendo lo último que se sabía. Un registro mal formado, una credencial que no descifra o un servidor desconocido son
 * definitivos para esa fila: servir la configuración anterior sería esconder el problema.
 */
export class TenantDirectoryError extends Error {
  readonly transient: boolean;

  constructor(message: string, options?: { cause?: unknown; transient?: boolean }) {
    super(message, options);
    this.name = "TenantDirectoryError";
    this.transient = options?.transient ?? false;
  }
}

const HOST_SHAPE = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/;

/** `Tienda-A.localhost:3000` → `tienda-a.localhost`; devuelve `undefined` si no parece un nombre de host válido. */
export function normalizeHost(raw: string | null | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }
  const host = raw.trim().toLowerCase().replace(/:\d+$/, "");
  return HOST_SHAPE.test(host) ? host : undefined;
}

/** Directorio fijo (pruebas): cada host es un negocio activo. */
export function staticDirectory(entries: Record<string, TenantRef>): TenantDirectory {
  const byHost = new Map(
    Object.entries(entries).map(([host, tenant]) => [host.toLowerCase(), tenant]),
  );
  return {
    async lookupByHost(host) {
      const normalized = normalizeHost(host);
      const tenant = normalized ? byHost.get(normalized) : undefined;
      return tenant ? { state: "active", tenant } : undefined;
    },
  };
}

export type CacheOptions = {
  /** Cuánto vale una respuesta con negocio. Es también lo que tarda en notarse una suspensión hecha desde otro proceso. */
  ttlMs: number;
  /** Cuánto vale "este host no es de nadie": corto, para que un negocio recién creado se vea pronto. */
  negativeTtlMs: number;
  /** Si la base central falla, se sigue sirviendo la última respuesta con negocio hasta este tiempo después de vencida. */
  staleIfErrorMs: number;
  /** Tope de hosts recordados: nadie puede llenar la memoria inventando nombres. */
  maxEntries: number;
  now: () => number;
  onStale?: (host: string, error: unknown) => void;
};

export const DEFAULT_CACHE: CacheOptions = {
  ttlMs: 20_000,
  negativeTtlMs: 5_000,
  staleIfErrorMs: 10 * 60_000,
  maxEntries: 2_000,
  now: Date.now,
};

/** Tras una falla de la base central no se vuelve a intentar durante este tiempo: se sirve lo último que se sabía. */
const RETRY_AFTER_ERROR_MS = 2_000;

type Slot = { entry: DirectoryEntry | undefined; at: number; retryNotBefore?: number };

export type CachedDirectory = TenantDirectory & {
  /** Olvida un host (o todos) para que la próxima consulta vaya a la base central. */
  invalidate(host?: string): void;
};

/**
 * Envuelve una función que consulta la base central con una caché corta:
 * - consultas simultáneas del mismo host comparten una sola pregunta a la base;
 * - lo que no existe también se recuerda un momento (un host inventado no puede castigar a la base central);
 * - si la base central no responde (un error `transient`), un negocio ya conocido sigue atendiéndose un rato: no se cae
 *   toda la plataforma por ella. Un error definitivo de esa fila (credencial que no descifra, servidor desconocido) no se
 *   disimula con la respuesta vieja.
 */
export function cachedDirectory(
  load: (host: string) => Promise<DirectoryEntry | undefined>,
  overrides: Partial<CacheOptions> = {},
): CachedDirectory {
  const options: CacheOptions = { ...DEFAULT_CACHE, ...overrides };
  const slots = new Map<string, Slot>();
  const pending = new Map<string, Promise<DirectoryEntry | undefined>>();

  const remember = (host: string, entry: DirectoryEntry | undefined): void => {
    slots.delete(host); // al reinsertar queda como el más reciente
    while (slots.size >= options.maxEntries) {
      const oldest = slots.keys().next();
      if (oldest.done) {
        break;
      }
      slots.delete(oldest.value);
    }
    slots.set(host, { entry, at: options.now() });
  };

  return {
    lookupByHost(raw) {
      const host = normalizeHost(raw);
      if (!host) {
        return Promise.resolve(undefined);
      }
      const now = options.now();
      const slot = slots.get(host);
      if (slot && now - slot.at < (slot.entry ? options.ttlMs : options.negativeTtlMs)) {
        return Promise.resolve(slot.entry);
      }
      if (slot?.entry && slot.retryNotBefore !== undefined && now < slot.retryNotBefore) {
        return Promise.resolve(slot.entry);
      }
      const inFlight = pending.get(host);
      if (inFlight) {
        return inFlight;
      }
      const request = load(host)
        .then(
          (entry) => {
            remember(host, entry);
            return entry;
          },
          (error: unknown) => {
            if (
              slot?.entry &&
              error instanceof TenantDirectoryError &&
              error.transient &&
              now - slot.at < options.ttlMs + options.staleIfErrorMs
            ) {
              slot.retryNotBefore = now + RETRY_AFTER_ERROR_MS;
              options.onStale?.(host, error);
              return slot.entry;
            }
            throw error;
          },
        )
        .finally(() => pending.delete(host));
      pending.set(host, request);
      return request;
    },
    invalidate(host) {
      if (host === undefined) {
        slots.clear();
        return;
      }
      const normalized = normalizeHost(host);
      if (normalized) {
        slots.delete(normalized);
      }
    },
  };
}
