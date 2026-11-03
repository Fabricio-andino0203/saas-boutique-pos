import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { FinanceType, PaymentMethod } from "@/modules/finance/schemas";

type Client = Prisma.TransactionClient | PrismaClient;

export type CategoryRow = {
  id: string;
  type: FinanceType;
  name: string;
  archived: boolean;
  /** Cuántos movimientos vigentes tiene: ayuda a decidir si conviene archivarla. */
  entryCount: number;
};

/** Las categorías de un tipo (o de los dos), en el orden del negocio; las archivadas solo si se piden. */
export async function listFinanceCategories(
  options: { type?: FinanceType; includeArchived?: boolean } = {},
  client: Client = db,
): Promise<CategoryRow[]> {
  const rows = await client.financeCategory.findMany({
    where: {
      ...(options.type ? { type: options.type } : {}),
      ...(options.includeArchived ? {} : { archivedAt: null }),
    },
    orderBy: [{ type: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { entries: { where: { voidedAt: null } } } } },
  });
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    name: row.name,
    archived: row.archivedAt !== null,
    entryCount: row._count.entries,
  }));
}

export type EntryFilters = {
  range: { from: Date; to: Date };
  type?: FinanceType;
  categoryId?: string;
  paidWith?: PaymentMethod;
  includeVoided?: boolean;
};

export type EntryRow = {
  id: string;
  type: FinanceType;
  occurredAt: Date;
  amountCents: number;
  description: string;
  paidWith: PaymentMethod;
  categoryId: string;
  categoryName: string;
  supplierName: string | null;
  createdByName: string;
  createdAt: Date;
  /** Salió de la caja del turno: no se anula desde Finanzas. */
  fromDrawer: boolean;
  fixedCostName: string | null;
  period: string | null;
  voidedAt: Date | null;
  voidedByName: string | null;
  voidReason: string | null;
};

export type EntryTotals = { expenseCents: number; incomeCents: number };

export const ENTRY_LIST_LIMIT = 300;

function whereOf(filters: EntryFilters): Prisma.FinanceEntryWhereInput {
  return {
    occurredAt: { gte: filters.range.from, lte: filters.range.to },
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(filters.paidWith ? { paidWith: filters.paidWith } : {}),
    ...(filters.includeVoided ? {} : { voidedAt: null }),
  };
}

/**
 * Los movimientos del periodo, del más reciente al más viejo, y los totales de lo vigente con los mismos filtros (los
 * anulados no suman). `truncated` avisa que hay más filas de las que se muestran; los totales siempre son de todas.
 */
export async function listFinanceEntries(
  filters: EntryFilters,
  client: Client = db,
): Promise<{ rows: EntryRow[]; totals: EntryTotals; truncated: boolean }> {
  const where = whereOf(filters);
  const [found, sums] = await Promise.all([
    client.financeEntry.findMany({
      where,
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
      take: ENTRY_LIST_LIMIT + 1,
      include: {
        category: { select: { name: true } },
        supplier: { select: { name: true } },
        createdBy: { select: { name: true } },
        voidedBy: { select: { name: true } },
        fixedCost: { select: { name: true } },
      },
    }),
    client.financeEntry.groupBy({
      by: ["type"],
      where: { ...where, voidedAt: null },
      _sum: { amountCents: true },
    }),
  ]);

  const rows = found.slice(0, ENTRY_LIST_LIMIT).map((row): EntryRow => ({
    id: row.id,
    type: row.type,
    occurredAt: row.occurredAt,
    amountCents: row.amountCents,
    description: row.description,
    paidWith: row.paidWith,
    categoryId: row.categoryId,
    categoryName: row.category.name,
    supplierName: row.supplier?.name ?? null,
    createdByName: row.createdBy.name,
    createdAt: row.createdAt,
    fromDrawer: row.cashMovementId !== null,
    fixedCostName: row.fixedCost?.name ?? null,
    period: row.period,
    voidedAt: row.voidedAt,
    voidedByName: row.voidedBy?.name ?? null,
    voidReason: row.voidReason,
  }));
  const total = (type: FinanceType) => sums.find((row) => row.type === type)?._sum.amountCents ?? 0;
  return {
    rows,
    totals: { expenseCents: total("EXPENSE"), incomeCents: total("INCOME") },
    truncated: found.length > ENTRY_LIST_LIMIT,
  };
}
