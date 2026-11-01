import { tenantRefFromRecord, type TenantRecord } from "../../src/lib/tenancy/control-directory";
import { closeControlDb, controlDb } from "../../src/lib/tenancy/control-db";
import { closeAllTenantClients } from "../../src/lib/tenancy/tenant-clients";
import { runWithTenant, type TenantRef } from "../../src/lib/tenancy/tenant-context";
import { serverEndpoint } from "../../src/lib/tenancy/tenant-url";
import { getVault } from "../../src/lib/tenancy/vault";

/**
 * Los procesos de línea de comandos (crear propietario, vencer apartados, conciliar, verificar los libros) trabajan para
 * **un negocio**:
 * - Modo `single` (una tienda, como siempre): la base de `DATABASE_URL`. Nada cambia.
 * - Modo `multi`: el negocio que se indique con `--tenant <subdominio>` (o la variable `TENANT`). Sin él, el proceso se
 *   niega: en este modo no existe una base "por defecto" a la que caer por descuido.
 */

const SELECT = {
  id: true,
  slug: true,
  name: true,
  status: true,
  dbServerId: true,
  dbName: true,
  dbRole: true,
  dbCredentialEnc: true,
} as const;

/** Un uso incorrecto del comando (falta el negocio, no existe…): se muestra el mensaje solo, sin la traza del error. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

/** Para el `catch` final de un comando: el mensaje de un uso incorrecto, o el error completo si es otra cosa. */
export function reportScriptError(error: unknown): void {
  console.error(error instanceof UsageError ? error.message : error);
  process.exitCode = 1;
}

export function isMultiTenant(): boolean {
  return process.env.TENANCY_MODE === "multi";
}

/** `--nombre valor` de la línea de comandos. */
export function flagValue(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

export function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function deps() {
  return { vault: getVault(), endpointFor: serverEndpoint };
}

/** Cómo conectarse a un negocio ya registrado (activo o suspendido: un proceso de mantenimiento puede necesitar ambos). */
export async function tenantRefBySlug(slug: string): Promise<TenantRef> {
  const record: TenantRecord | null = await controlDb.tenant.findUnique({
    where: { slug },
    select: SELECT,
  });
  if (!record || !["ACTIVE", "SUSPENDED", "PENDING_DELETION"].includes(record.status)) {
    throw new UsageError(`No existe un negocio "${slug}" con base de datos disponible.`);
  }
  return tenantRefFromRecord(record, deps());
}

/** Los negocios que operan, para las tareas que recorren a todos (p. ej. vencer apartados). */
export async function activeTenantRefs(): Promise<TenantRef[]> {
  const records: TenantRecord[] = await controlDb.tenant.findMany({
    where: { status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: SELECT,
  });
  return records.map((record) => tenantRefFromRecord(record, deps()));
}

/** Ejecuta `fn` para el negocio indicado (en modo `multi`) o para la tienda única (en modo `single`). */
export async function runForTenant<T>(fn: () => Promise<T>): Promise<T> {
  if (!isMultiTenant()) {
    return fn();
  }
  const slug = flagValue("tenant") ?? process.env.TENANT;
  if (!slug) {
    throw new UsageError(
      "Con TENANCY_MODE=multi indica el negocio: --tenant <subdominio> (o la variable TENANT).",
    );
  }
  return runWithTenant(await tenantRefBySlug(slug), fn);
}

/**
 * Ejecuta `fn` una vez por cada negocio activo (o una sola vez en modo `single`). Un negocio que falla no impide los demás;
 * devuelve cuántos fallaron para que el proceso termine con código distinto de cero.
 */
export async function runForEachTenant(
  fn: (label: string) => Promise<void>,
): Promise<{ failed: number }> {
  if (!isMultiTenant()) {
    await fn("tienda");
    return { failed: 0 };
  }
  let failed = 0;
  for (const tenant of await activeTenantRefs()) {
    try {
      await runWithTenant(tenant, () => fn(tenant.slug ?? tenant.id));
    } catch (error) {
      failed += 1;
      console.error(`[${tenant.slug}] falló:`, error instanceof Error ? error.message : error);
    }
  }
  return { failed };
}

/** Cierra todas las conexiones abiertas (negocios y base central) para que el proceso termine. */
export async function finishScript(): Promise<void> {
  await closeAllTenantClients();
  if (isMultiTenant()) {
    await closeControlDb();
  }
}
