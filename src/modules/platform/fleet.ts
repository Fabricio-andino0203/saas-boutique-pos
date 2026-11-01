import type { TenantStatus } from "@/generated/control/client";
import { controlDb, type ControlDb } from "@/lib/tenancy/control-db";
import { invalidateTenantDirectory } from "@/lib/tenancy/control-directory";
import { adminUrlFor, ensureMigrated, latestMigrationName } from "@/lib/tenancy/provision-steps";
import { recordPlatformAudit } from "@/modules/platform/audit";
import {
  describeFailure,
  provisioningConfig,
  type ProvisioningDeps,
} from "@/modules/platform/provisioning";
import type { AdminContext } from "@/modules/platform/service";

/**
 * Migración de la flota (propuesta SaaS §7): lleva la base de cada negocio a la última versión del esquema.
 *
 * - Solo se migra a quien lo necesita (su versión anotada no es la última), salvo con `force`.
 * - Primero los **canarios**: si uno falla, no se toca al resto.
 * - Concurrencia limitada.
 * - Un negocio que falla **no detiene a los demás**: si estaba activo pasa a `MIGRATION_FAILED` («en mantenimiento») con el
 *   motivo anotado, y vuelve a `ACTIVE` en la primera migración que sí funcione.
 */

/** Estados que tienen una base que migrar. (En alta, fallidos y archivados no.) */
const MIGRATABLE: TenantStatus[] = ["ACTIVE", "SUSPENDED", "PENDING_DELETION", "MIGRATION_FAILED"];

export type FleetOptions = {
  /** Cuántas bases se migran a la vez (por omisión 4). */
  concurrency?: number;
  /** Migrar a todos aunque su versión anotada ya sea la última. */
  force?: boolean;
  /** Solo estos subdominios. */
  only?: string[];
  /** Si falla un canario, no se toca a los demás (por omisión sí). */
  canaryGate?: boolean;
};

export type FleetEntry = {
  slug: string;
  result: "migrated" | "skipped" | "failed" | "blocked";
  from?: string | null;
  to?: string;
  error?: string;
};

export type FleetReport = {
  latest: string;
  entries: FleetEntry[];
  migrated: number;
  skipped: number;
  failed: number;
  blocked: number;
};

export type FleetDeps = Pick<ProvisioningDeps, "client" | "config" | "migrate" | "now">;

async function runPool<T>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.max(1, Math.min(limit, queue.length)) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
      await work(item);
    }
  });
  await Promise.all(workers);
}

export async function migrateFleet(
  options: FleetOptions,
  context: AdminContext,
  deps: FleetDeps = {},
): Promise<FleetReport> {
  const client: ControlDb = deps.client ?? controlDb;
  const config = provisioningConfig(deps.config);
  const now = deps.now ?? (() => new Date());
  const latest = latestMigrationName();

  const tenants = await client.tenant.findMany({
    where: {
      status: { in: MIGRATABLE },
      dbName: { not: null },
      ...(options.only ? { slug: { in: options.only } } : {}),
    },
    orderBy: [{ canary: "desc" }, { createdAt: "asc" }],
  });

  const entries: FleetEntry[] = [];
  const pending = tenants.filter((tenant) => {
    const needs =
      options.force || tenant.schemaVersion !== latest || tenant.status === "MIGRATION_FAILED";
    if (!needs) {
      entries.push({ slug: tenant.slug, result: "skipped", to: tenant.schemaVersion ?? latest });
    }
    return needs;
  });

  const migrateOne = async (tenant: (typeof tenants)[number]): Promise<void> => {
    try {
      const version = await ensureMigrated(adminUrlFor(config.adminUrl, tenant.dbName as string), {
        latest,
        ...(options.force ? { force: true } : {}),
        ...(deps.migrate ? { migrate: deps.migrate } : {}),
      });
      await client.tenant.update({
        where: { id: tenant.id },
        data: {
          schemaVersion: version,
          migrationError: null,
          migrationFailedAt: null,
          ...(tenant.status === "MIGRATION_FAILED" ? { status: "ACTIVE" } : {}),
        },
      });
      entries.push({
        slug: tenant.slug,
        result: "migrated",
        from: tenant.schemaVersion,
        to: version,
      });
    } catch (error) {
      const message = describeFailure(error);
      await client.$transaction(async (tx) => {
        await tx.tenant.update({
          where: { id: tenant.id },
          data: {
            migrationError: message,
            migrationFailedAt: now(),
            // Solo un negocio que atiende pasa a mantenimiento; uno suspendido ya no atiende.
            ...(tenant.status === "ACTIVE" ? { status: "MIGRATION_FAILED" } : {}),
          },
        });
        await recordPlatformAudit(tx, {
          action: "TENANT_MIGRATION_FAILED",
          actor: context.actor,
          tenantId: tenant.id,
          targetType: "Tenant",
          targetId: tenant.id,
          details: { slug: tenant.slug, from: tenant.schemaVersion, error: message },
          ip: context.ip,
        });
      });
      entries.push({
        slug: tenant.slug,
        result: "failed",
        from: tenant.schemaVersion,
        error: message,
      });
    }
  };

  const concurrency = options.concurrency ?? 4;
  const canaries = pending.filter((tenant) => tenant.canary);
  const rest = pending.filter((tenant) => !tenant.canary);
  await runPool(canaries, concurrency, migrateOne);

  const canaryFailed = entries.filter(
    (entry) => entry.result === "failed" && canaries.some((tenant) => tenant.slug === entry.slug),
  );
  if (canaryFailed.length > 0 && options.canaryGate !== false) {
    for (const tenant of rest) {
      entries.push({
        slug: tenant.slug,
        result: "blocked",
        error: `No se migró: falló el canario ${canaryFailed.map((entry) => entry.slug).join(", ")}`,
      });
    }
  } else {
    await runPool(rest, concurrency, migrateOne);
  }

  const count = (result: FleetEntry["result"]) =>
    entries.filter((entry) => entry.result === result).length;
  const report: FleetReport = {
    latest,
    entries: entries.sort((a, b) => a.slug.localeCompare(b.slug)),
    migrated: count("migrated"),
    skipped: count("skipped"),
    failed: count("failed"),
    blocked: count("blocked"),
  };
  if (report.migrated + report.failed + report.blocked > 0) {
    await recordPlatformAudit(client, {
      action: "FLEET_MIGRATED",
      actor: context.actor,
      details: {
        latest,
        migrated: report.migrated,
        skipped: report.skipped,
        failed: report.entries
          .filter((entry) => entry.result === "failed")
          .map((entry) => entry.slug),
        blocked: report.blocked,
      },
      ip: context.ip,
    });
  }
  invalidateTenantDirectory();
  return report;
}
