import type { TenantStatus } from "@/generated/control/client";
import { logger } from "@/lib/logger";
import { controlDb } from "@/lib/tenancy/control-db";
import {
  cachedDirectory,
  TenantDirectoryError,
  type CachedDirectory,
  type DirectoryEntry,
  type TenantDirectory,
} from "@/lib/tenancy/directory";
import { slugFromHost } from "@/lib/tenancy/slug";
import type { TenantRef } from "@/lib/tenancy/tenant-context";
import { serverEndpoint, tenantDatabaseUrl, type ServerEndpoint } from "@/lib/tenancy/tenant-url";
import { getVault, vaultContext, type Vault } from "@/lib/tenancy/vault";

/**
 * El directorio de hosts de verdad (Etapa 2): `<slug>.<TENANT_BASE_DOMAIN>` se busca en la tabla `Tenant` de la base central,
 * se descifra la credencial de la base del negocio con la bóveda y se arma su URL. Con una caché corta (ver `directory.ts`).
 */

export type TenantRecord = {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  dbServerId: string;
  dbName: string | null;
  dbRole: string | null;
  dbCredentialEnc: string | null;
};

export type RecordDeps = {
  vault: Pick<Vault, "decrypt">;
  endpointFor: (serverId: string) => ServerEndpoint;
};

/**
 * Cómo conectarse a la base de un negocio: abre su credencial en la bóveda y arma la URL. Lo usan la atención de peticiones
 * (solo negocios activos) y los procesos de línea de comandos (también suspendidos, p. ej. para verificar sus libros).
 */
export function tenantRefFromRecord(record: TenantRecord, deps: RecordDeps): TenantRef {
  if (!record.dbName || !record.dbRole || !record.dbCredentialEnc) {
    throw new TenantDirectoryError(
      `El negocio ${record.slug} no tiene base o credencial registrada`,
    );
  }
  let password: string;
  try {
    password = deps.vault.decrypt(record.dbCredentialEnc, vaultContext.tenantDatabase(record.id));
  } catch (cause) {
    throw new TenantDirectoryError(
      `No se pudo descifrar la credencial de la base del negocio ${record.slug}`,
      { cause },
    );
  }
  let endpoint: ServerEndpoint;
  try {
    endpoint = deps.endpointFor(record.dbServerId);
  } catch (cause) {
    throw new TenantDirectoryError(
      `El negocio ${record.slug} está en un servidor de base de datos desconocido (${record.dbServerId})`,
      { cause },
    );
  }
  return {
    id: record.id,
    slug: record.slug,
    databaseUrl: tenantDatabaseUrl({
      endpoint,
      database: record.dbName,
      role: record.dbRole,
      password,
    }),
  };
}

/** Qué hace cada estado del negocio al llegar una petición a su dirección (propuesta SaaS §5, ciclo de vida). */
export function entryFromRecord(
  record: TenantRecord,
  deps: RecordDeps,
): DirectoryEntry | undefined {
  switch (record.status) {
    case "ACTIVE":
      return { state: "active", tenant: tenantRefFromRecord(record, deps) };
    case "SUSPENDED":
    case "PENDING_DELETION":
      return {
        state: "suspended",
        tenant: { id: record.id, slug: record.slug, name: record.name },
      };
    default:
      // En preparación, fallido o dado de baja: la dirección no atiende a nadie.
      return undefined;
  }
}

export type ControlDirectoryOptions = {
  baseDomain: string | undefined;
  find?: ((slug: string) => Promise<TenantRecord | null>) | undefined;
  deps?: (() => RecordDeps) | undefined;
  ttlMs?: number | undefined;
};

function findInControl(slug: string): Promise<TenantRecord | null> {
  return controlDb.tenant.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      name: true,
      status: true,
      dbServerId: true,
      dbName: true,
      dbRole: true,
      dbCredentialEnc: true,
    },
  });
}

export function createControlDirectory(options: ControlDirectoryOptions): CachedDirectory {
  const find = options.find ?? findInControl;
  const deps = options.deps ?? (() => ({ vault: getVault(), endpointFor: serverEndpoint }));
  const load = async (host: string): Promise<DirectoryEntry | undefined> => {
    // Sin dominio base no se sabe qué es "un negocio": nada lo es (falla cerrado).
    const slug = options.baseDomain ? slugFromHost(host, options.baseDomain) : undefined;
    if (!slug) {
      return undefined;
    }
    let record: TenantRecord | null;
    try {
      record = await find(slug);
    } catch (cause) {
      throw new TenantDirectoryError("No se pudo consultar la base central", {
        cause,
        transient: true,
      });
    }
    return record ? entryFromRecord(record, deps()) : undefined;
  };
  return cachedDirectory(load, {
    ...(options.ttlMs === undefined
      ? {}
      : { ttlMs: options.ttlMs, negativeTtlMs: Math.min(options.ttlMs, 5_000) }),
    onStale: (host, error) => logger.warn("tenant.directory_stale", { host, error }),
  });
}

function directoryFromEnv(): CachedDirectory {
  const ttl = process.env.TENANT_DIRECTORY_TTL_MS;
  return createControlDirectory({
    baseDomain: process.env.TENANT_BASE_DOMAIN?.trim().toLowerCase() || undefined,
    ttlMs: ttl ? Number(ttl) : undefined,
  });
}

const globalDirectory = globalThis as typeof globalThis & {
  __boutiqueTenantDirectory?: TenantDirectory;
};

export function getTenantDirectory(): TenantDirectory {
  return (globalDirectory.__boutiqueTenantDirectory ??= directoryFromEnv());
}

/** Solo para pruebas: cambia o limpia el directorio del proceso. */
export function setTenantDirectory(directory: TenantDirectory | undefined): void {
  globalDirectory.__boutiqueTenantDirectory = directory;
}

/** Olvida un host (o todos) en este proceso. Otros procesos lo notan al vencer la caché (`TENANT_DIRECTORY_TTL_MS`). */
export function invalidateTenantDirectory(host?: string): void {
  const directory = globalDirectory.__boutiqueTenantDirectory as
    Partial<CachedDirectory> | undefined;
  directory?.invalidate?.(host);
}
