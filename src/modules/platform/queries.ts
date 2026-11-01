import type { Prisma, TenantStatus } from "@/generated/control/client";
import { controlDb, type ControlDb } from "@/lib/tenancy/control-db";
import { getVault } from "@/lib/tenancy/vault";
import type { PlatformAuditFilters } from "@/modules/platform/schemas";

export const AUDIT_PAGE_SIZE = 25;

export type TenantRow = {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  schemaVersion: string | null;
  createdAt: Date;
};

export async function listTenants(client: ControlDb = controlDb): Promise<TenantRow[]> {
  return client.tenant.findMany({
    orderBy: { createdAt: "asc" }, // el negocio #1 primero
    select: {
      id: true,
      slug: true,
      name: true,
      status: true,
      schemaVersion: true,
      createdAt: true,
    },
  });
}

export type PlatformSummary = {
  tenantsTotal: number;
  tenantsByStatus: Partial<Record<TenantStatus, number>>;
  activeAdmins: number;
  vaultKeyVersion: number;
  recent: AuditRow[];
};

export async function getPlatformSummary(client: ControlDb = controlDb): Promise<PlatformSummary> {
  const [byStatus, activeAdmins, recent] = await Promise.all([
    client.tenant.groupBy({ by: ["status"], _count: { _all: true } }),
    client.platformUser.count({ where: { isActive: true } }),
    client.platformAuditLog.findMany({ orderBy: { at: "desc" }, take: 5 }),
  ]);
  const tenantsByStatus: Partial<Record<TenantStatus, number>> = {};
  let tenantsTotal = 0;
  for (const row of byStatus) {
    tenantsByStatus[row.status] = row._count._all;
    tenantsTotal += row._count._all;
  }
  return {
    tenantsTotal,
    tenantsByStatus,
    activeAdmins,
    vaultKeyVersion: getVault().currentVersion,
    recent: recent.map(toAuditRow),
  };
}

export type AuditRow = {
  id: string;
  at: Date;
  actorUsername: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  details: unknown;
  ip: string | null;
};

function toAuditRow(row: {
  id: string;
  at: Date;
  actorUsername: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  details: unknown;
  ip: string | null;
}): AuditRow {
  return {
    id: row.id,
    at: row.at,
    actorUsername: row.actorUsername,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    details: row.details,
    ip: row.ip,
  };
}

/** Un día `YYYY-MM-DD` interpretado en hora de Honduras (UTC−6, sin horario de verano). */
function dayStart(day: string): Date {
  return new Date(`${day}T00:00:00-06:00`);
}

export async function searchPlatformAudit(
  filters: PlatformAuditFilters,
  client: ControlDb = controlDb,
): Promise<{ rows: AuditRow[]; page: number; pages: number; total: number }> {
  const where: Prisma.PlatformAuditLogWhereInput = {};
  if (filters.action) {
    where.action = filters.action;
  }
  if (filters.from || filters.to) {
    where.at = {
      ...(filters.from ? { gte: dayStart(filters.from) } : {}),
      // El día "hasta" se incluye completo: el límite es el comienzo del día siguiente.
      ...(filters.to ? { lt: new Date(dayStart(filters.to).getTime() + 24 * 3_600_000) } : {}),
    };
  }
  const total = await client.platformAuditLog.count({ where });
  const pages = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
  const page = Math.min(filters.page, pages);
  const rows = await client.platformAuditLog.findMany({
    where,
    orderBy: [{ at: "desc" }, { id: "desc" }],
    skip: (page - 1) * AUDIT_PAGE_SIZE,
    take: AUDIT_PAGE_SIZE,
  });
  return { rows: rows.map(toAuditRow), page, pages, total };
}
