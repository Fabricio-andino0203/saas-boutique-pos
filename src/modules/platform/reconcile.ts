import type { TenantStatus } from "@/generated/control/client";
import { controlDb, type ControlDb } from "@/lib/tenancy/control-db";
import {
  latestMigrationName,
  listDatabaseNames,
  listManagedResources,
} from "@/lib/tenancy/provision-steps";
import {
  DEFAULT_STALE_AFTER_MS,
  provisioningConfig,
  type ProvisioningDeps,
} from "@/modules/platform/provisioning";

/**
 * Conciliación (propuesta SaaS §4): compara lo que **dice** la base central con lo que **hay** en el servidor de Postgres y
 * reporta las diferencias. No arregla nada por su cuenta: quien opera decide (rehacer un alta, archivar, borrar a mano).
 */

/** Estados en los que el negocio debe tener su base en el servidor. */
const EXPECTS_DATABASE: TenantStatus[] = [
  "ACTIVE",
  "SUSPENDED",
  "PENDING_DELETION",
  "MIGRATION_FAILED",
];

/** Prefijo de la base que una restauración deja apartada al poner el respaldo en su lugar. */
export const REPLACED_PREFIX = "z_replaced_";

export type ReconcileReport = {
  /** Bases `t_*` o `z_archived_*` del servidor que ningún negocio reclama. */
  orphanDatabases: string[];
  /** Bases apartadas por una restauración: no son un error, solo hay que borrarlas cuando ya no se necesiten (borrado guiado). */
  replacedDatabases: string[];
  /** Roles `t_*` del servidor que ningún negocio reclama. */
  orphanRoles: string[];
  /** Negocios que deberían tener base y no está en el servidor. */
  missingDatabases: { slug: string; database: string }[];
  /** Negocios archivados cuya base archivada no está en el servidor. */
  missingArchives: { slug: string; database: string }[];
  /** Altas «en marcha» sin signos de vida: el proceso que las corría murió; hay que retomarlas o deshacerlas. */
  staleRuns: { slug: string; runId: string; heartbeatAt: Date }[];
  /** Negocios cuya versión de datos no es la última de esta versión del sistema. */
  behind: { slug: string; schemaVersion: string | null; latest: string }[];
  /** `true` si no hay nada que revisar. */
  ok: boolean;
};

export async function reconcileTenants(
  deps: Pick<ProvisioningDeps, "client" | "config" | "now" | "staleAfterMs"> = {},
): Promise<ReconcileReport> {
  const client: ControlDb = deps.client ?? controlDb;
  const { adminUrl } = provisioningConfig(deps.config);
  const now = (deps.now ?? (() => new Date()))();
  const latest = latestMigrationName();

  const [tenants, inventory, present, runs] = await Promise.all([
    client.tenant.findMany({
      select: {
        slug: true,
        status: true,
        dbName: true,
        dbRole: true,
        archivedDbName: true,
        schemaVersion: true,
      },
    }),
    listManagedResources(adminUrl),
    listDatabaseNames(adminUrl),
    client.provisioningRun.findMany({
      where: {
        status: "RUNNING",
        heartbeatAt: {
          lt: new Date(now.getTime() - (deps.staleAfterMs ?? DEFAULT_STALE_AFTER_MS)),
        },
      },
      include: { tenant: { select: { slug: true } } },
    }),
  ]);

  // Lo que cada negocio reclama: su base y su rol mientras no esté archivado, y su base archivada.
  const claimedDatabases = new Set<string>();
  const claimedRoles = new Set<string>();
  for (const tenant of tenants) {
    if (tenant.status !== "DELETED") {
      if (tenant.dbName) claimedDatabases.add(tenant.dbName);
      if (tenant.dbRole) claimedRoles.add(tenant.dbRole);
    }
    if (tenant.archivedDbName) claimedDatabases.add(tenant.archivedDbName);
  }

  const report: Omit<ReconcileReport, "ok"> = {
    orphanDatabases: inventory.databases.filter(
      (name) => !claimedDatabases.has(name) && !name.startsWith(REPLACED_PREFIX),
    ),
    replacedDatabases: inventory.databases.filter((name) => name.startsWith(REPLACED_PREFIX)),
    orphanRoles: inventory.roles.filter((name) => !claimedRoles.has(name)),
    missingDatabases: tenants
      .filter((tenant) => EXPECTS_DATABASE.includes(tenant.status) && tenant.dbName)
      .filter((tenant) => !present.has(tenant.dbName as string))
      .map((tenant) => ({ slug: tenant.slug, database: tenant.dbName as string })),
    missingArchives: tenants
      .filter((tenant) => tenant.status === "DELETED" && tenant.archivedDbName)
      .filter((tenant) => !present.has(tenant.archivedDbName as string))
      .map((tenant) => ({ slug: tenant.slug, database: tenant.archivedDbName as string })),
    staleRuns: runs.map((run) => ({
      slug: run.tenant.slug,
      runId: run.id,
      heartbeatAt: run.heartbeatAt,
    })),
    behind: tenants
      .filter(
        (tenant) => EXPECTS_DATABASE.includes(tenant.status) && tenant.schemaVersion !== latest,
      )
      .map((tenant) => ({ slug: tenant.slug, schemaVersion: tenant.schemaVersion, latest })),
  };
  return {
    ...report,
    // Las bases apartadas por una restauración se muestran, pero no cuentan como algo que no cuadra.
    ok: Object.entries(report).every(
      ([key, list]) => key === "replacedDatabases" || list.length === 0,
    ),
  };
}
