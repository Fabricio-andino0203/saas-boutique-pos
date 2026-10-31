import type { TenantRef } from "@/lib/tenancy/tenant-context";

/**
 * De dónde sale el negocio de una petición: **solo** del nombre de host, que se busca en un directorio de confianza. Nada que
 * mande el navegador (rutas, parámetros, cuerpo, cookies) puede elegir el negocio.
 *
 * En la Etapa 0 el directorio es una tabla fija (`TENANT_POC_DIRECTORY`); en la Etapa 1 pasa a ser la base central.
 */
export type TenantDirectory = {
  lookupByHost(host: string): TenantRef | undefined;
};

const HOST_SHAPE = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/;

/** `Tienda-A.localhost:3000` → `tienda-a.localhost`; devuelve `undefined` si no parece un nombre de host válido. */
export function normalizeHost(raw: string | null | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }
  const host = raw.trim().toLowerCase().replace(/:\d+$/, "");
  return HOST_SHAPE.test(host) ? host : undefined;
}

export function staticDirectory(entries: Record<string, TenantRef>): TenantDirectory {
  const byHost = new Map(
    Object.entries(entries).map(([host, tenant]) => [host.toLowerCase(), tenant]),
  );
  return {
    lookupByHost(host) {
      const normalized = normalizeHost(host);
      return normalized ? byHost.get(normalized) : undefined;
    },
  };
}

function directoryFromEnv(): TenantDirectory {
  const raw = process.env.TENANT_POC_DIRECTORY;
  return staticDirectory(raw ? (JSON.parse(raw) as Record<string, TenantRef>) : {});
}

const globalDirectory = globalThis as typeof globalThis & {
  __boutiqueTenantDirectory?: TenantDirectory;
};

export function getTenantDirectory(): TenantDirectory {
  return (globalDirectory.__boutiqueTenantDirectory ??= directoryFromEnv());
}

export function setTenantDirectory(directory: TenantDirectory | undefined): void {
  globalDirectory.__boutiqueTenantDirectory = directory;
}
