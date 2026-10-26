import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { endOfLocalDay, parseLocalDateKey, startOfLocalDay } from "@/lib/dates";
import type { AuditFilters } from "@/modules/audit/schemas";

export const AUDIT_PAGE_SIZE = 25;

export async function searchAuditLog(
  filters: AuditFilters,
  client: Pick<PrismaClient, "auditLog"> = db,
) {
  const from = filters.from ? parseLocalDateKey(filters.from) : null;
  const to = filters.to ? parseLocalDateKey(filters.to) : null;

  const where: Prisma.AuditLogWhereInput = {
    ...(filters.action ? { action: filters.action } : {}),
    ...(filters.entityType ? { entityType: filters.entityType } : {}),
    ...(filters.userId ? { userId: filters.userId } : {}),
    ...(from || to
      ? {
          createdAt: {
            ...(from ? { gte: startOfLocalDay(from) } : {}),
            ...(to ? { lte: endOfLocalDay(to) } : {}),
          },
        }
      : {}),
  };

  const page = Math.max(1, filters.page);
  const [rows, total] = await Promise.all([
    client.auditLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * AUDIT_PAGE_SIZE,
      take: AUDIT_PAGE_SIZE,
      include: { user: { select: { name: true, username: true } } },
    }),
    client.auditLog.count({ where }),
  ]);

  return {
    rows,
    total,
    page,
    pageSize: AUDIT_PAGE_SIZE,
    pages: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)),
  };
}
