import { controlDb, type ControlDb } from "@/lib/tenancy/control-db";
import { backupOverview } from "@/modules/platform/backups";
import { nearLimit } from "@/modules/platform/usage";
import { provisioningAvailable, type ProvisioningDeps } from "@/modules/platform/provisioning";
import { reconcileTenants } from "@/modules/platform/reconcile";
import { countOpenSupportSessions } from "@/modules/platform/support";
import { listRetiredDatabases } from "@/modules/platform/retired";

/**
 * Alertas de la plataforma (propuesta SaaS §7, «monitoreo»): lo que alguien debe atender, reunido en una sola lista con su
 * gravedad. La misma lista alimenta el Resumen del panel y `pnpm alerts:check`, que sale con error si hay algo grave y sirve
 * para que un `cron` avise por correo (un monitor externo solo ve que la aplicación responde; esto ve que los respaldos y las
 * bases estén bien).
 *
 * - `critical`: se pueden perder datos o un negocio no atiende (un respaldo falló o no existe, falta la base de un negocio).
 * - `warning`: algo está fuera de lo normal y conviene revisarlo pronto.
 * - `info`: oportunidades y pendientes sin urgencia (un negocio cerca de su tope, bases apartadas por borrar).
 */

export const ALERT_CODES = [
  "backup_failed",
  "backup_never",
  "backup_stale",
  "backup_service_stalled",
  "migration_failed",
  "provisioning_failed",
  "server_database_missing",
  "server_orphans",
  "server_behind",
  "near_limit",
  "retired_databases",
  "support_open",
] as const;
export type AlertCode = (typeof ALERT_CODES)[number];

export type AlertSeverity = "critical" | "warning" | "info";

export type PlatformAlert = {
  code: AlertCode;
  severity: AlertSeverity;
  /** El negocio al que se refiere; ausente en las alertas de toda la plataforma. */
  slug?: string;
  name?: string;
  /** Un dato corto para completar el mensaje (p. ej. el nombre de la base, o «usuarios»). */
  detail?: string;
};

const SEVERITY_ORDER: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };

/** Un respaldo pedido que lleva más de esto sin que el servicio de respaldos lo tome: ese servicio no está corriendo. */
export const STALLED_AFTER_MS = 10 * 60 * 1000;

export type AlertsDeps = Pick<ProvisioningDeps, "client" | "config" | "now"> & {
  /** Revisar también el servidor de bases (conciliación). Sin la cuenta de aprovisionamiento se omite sola. */
  reconcile?: boolean;
};

export async function collectAlerts(deps: AlertsDeps = {}): Promise<PlatformAlert[]> {
  const client: ControlDb = deps.client ?? controlDb;
  const now = (deps.now ?? (() => new Date()))();
  const alerts: PlatformAlert[] = [];

  // Respaldos.
  const backups = await backupOverview({ client, now: () => now });
  for (const item of backups.attention) {
    if (item.state === "pending" || item.state === "ok") {
      continue;
    }
    const code: AlertCode =
      item.state === "failed"
        ? "backup_failed"
        : item.state === "never"
          ? "backup_never"
          : "backup_stale";
    alerts.push({
      code,
      severity: item.state === "stale" ? "warning" : "critical",
      ...(item.slug && item.name ? { slug: item.slug, name: item.name } : { detail: "control" }),
    });
  }
  const stalled = await client.tenantBackup.count({
    where: {
      status: "REQUESTED",
      requestedAt: { lt: new Date(now.getTime() - STALLED_AFTER_MS) },
    },
  });
  if (stalled > 0) {
    alerts.push({ code: "backup_service_stalled", severity: "critical", detail: String(stalled) });
  }

  // Negocios que no atienden por una actualización o un alta que falló.
  const broken = await client.tenant.findMany({
    where: { status: { in: ["MIGRATION_FAILED", "FAILED"] } },
    orderBy: { createdAt: "asc" },
    select: { slug: true, name: true, status: true },
  });
  for (const tenant of broken) {
    alerts.push({
      code: tenant.status === "FAILED" ? "provisioning_failed" : "migration_failed",
      severity: tenant.status === "FAILED" ? "warning" : "critical",
      slug: tenant.slug,
      name: tenant.name,
    });
  }

  // Lo registrado contra lo que hay en el servidor.
  if (deps.reconcile !== false && provisioningAvailable()) {
    try {
      const report = await reconcileTenants({
        client,
        ...(deps.config ? { config: deps.config } : {}),
        now: () => now,
      });
      for (const item of report.missingDatabases) {
        alerts.push({
          code: "server_database_missing",
          severity: "critical",
          slug: item.slug,
          detail: item.database,
        });
      }
      if (report.orphanDatabases.length + report.orphanRoles.length > 0) {
        alerts.push({
          code: "server_orphans",
          severity: "warning",
          detail: String(report.orphanDatabases.length + report.orphanRoles.length),
        });
      }
      if (report.behind.length > 0) {
        alerts.push({
          code: "server_behind",
          severity: "warning",
          detail: String(report.behind.length),
        });
      }
      const retired = await listRetiredDatabases({
        client,
        ...(deps.config ? { config: deps.config } : {}),
        now: () => now,
      });
      if (retired.length > 0) {
        alerts.push({
          code: "retired_databases",
          severity: "info",
          detail: String(retired.length),
        });
      }
    } catch {
      // Sin acceso al servidor de bases no hay conciliación; las demás alertas siguen valiendo.
    }
  }

  // Alguien está mirando datos reales de un negocio.
  const openSupport = await countOpenSupportSessions({ client, now: () => now });
  if (openSupport > 0) {
    alerts.push({ code: "support_open", severity: "info", detail: String(openSupport) });
  }

  // Negocios que llegaron al 90 % de un tope de su plan (según la última foto de uso).
  const snapshots = await client.tenant.findMany({
    where: { status: { in: ["ACTIVE", "SUSPENDED"] } },
    select: {
      slug: true,
      name: true,
      usageSnapshots: { orderBy: { takenAt: "desc" }, take: 1 },
      subscriptions: {
        where: { status: { not: "EXPIRED" } },
        take: 1,
        select: { plan: { select: { limits: true } } },
      },
    },
  });
  for (const tenant of snapshots) {
    const snapshot = tenant.usageSnapshots[0];
    const limits = tenant.subscriptions[0]?.plan.limits as
      { users?: number | null; products?: number | null } | undefined;
    if (!snapshot || !limits) {
      continue;
    }
    if (nearLimit(snapshot.activeUsers, limits.users ?? null)) {
      alerts.push({
        code: "near_limit",
        severity: "info",
        slug: tenant.slug,
        name: tenant.name,
        detail: "users",
      });
    }
    if (nearLimit(snapshot.products, limits.products ?? null)) {
      alerts.push({
        code: "near_limit",
        severity: "info",
        slug: tenant.slug,
        name: tenant.name,
        detail: "products",
      });
    }
  }

  return alerts.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/** Lo que obliga a alguien a actuar: `critical` y `warning`. (`info` no hace fallar a `alerts:check`.) */
export function needsAction(alerts: PlatformAlert[]): boolean {
  return alerts.some((alert) => alert.severity !== "info");
}
