import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { localDateKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { dueDateKey, pendingPeriods, periodOf } from "@/modules/finance/periods";
import type { FinanceType, PaymentMethod } from "@/modules/finance/schemas";
import { computeFinanceSummary, type FinanceSummary } from "@/modules/finance/summary";
import { getSalesSummary } from "@/modules/reports/queries";
import type { ReportRange } from "@/modules/reports/ranges";

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
  /** Cuántas filas traer como máximo (por omisión {@link ENTRY_LIST_LIMIT}; la exportación pide todas). */
  limit?: number;
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
  const limit = filters.limit ?? ENTRY_LIST_LIMIT;
  const [found, sums] = await Promise.all([
    client.financeEntry.findMany({
      where,
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
      take: limit + 1,
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

  const rows = found.slice(0, limit).map((row): EntryRow => ({
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
    truncated: found.length > limit,
  };
}

export type SupplierOption = { id: string; name: string };

/** Los proveedores activos, para elegir a quién se le pagó un gasto. */
export async function listSupplierOptions(client: Client = db): Promise<SupplierOption[]> {
  return client.supplier.findMany({
    where: { archivedAt: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

// ───────────────────────── Costos fijos ─────────────────────────

export type PendingPayment = {
  fixedCostId: string;
  name: string;
  categoryName: string;
  /** El mes que falta pagar (`2026-11`). */
  period: string;
  /** La fecha límite de ese mes (`2026-11-05`). */
  dueDate: string;
  /** El monto habitual: el pago puede ajustarlo. */
  amountCents: number;
  overdue: boolean;
};

export type FixedCostRow = {
  id: string;
  name: string;
  categoryId: string;
  categoryName: string;
  amountCents: number;
  dueDay: number;
  /** Primer y último mes, como `2026-11`. */
  startsOn: string;
  endsOn: string | null;
  archived: boolean;
  /** Cuántos meses faltan por pagar (los de la ventana que se muestra). */
  pendingCount: number;
};

/** Los costos fijos con cuántos meses les faltan por pagar. Los archivados solo si se piden. */
export async function listFixedCosts(
  options: { includeArchived?: boolean } = {},
  now: Date = new Date(),
  client: Client = db,
): Promise<{ costs: FixedCostRow[]; pending: PendingPayment[] }> {
  const rows = await client.fixedCost.findMany({
    where: options.includeArchived ? {} : { archivedAt: null },
    orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { dueDay: "asc" }, { name: "asc" }],
    include: { category: { select: { name: true } } },
  });
  const paidRows = await client.financeEntry.findMany({
    where: {
      fixedCostId: { in: rows.map((row) => row.id) },
      voidedAt: null,
      period: { not: null },
    },
    select: { fixedCostId: true, period: true },
  });
  const paidBy = new Map<string, Set<string>>();
  for (const paid of paidRows) {
    if (paid.fixedCostId && paid.period) {
      const set = paidBy.get(paid.fixedCostId) ?? new Set<string>();
      set.add(paid.period);
      paidBy.set(paid.fixedCostId, set);
    }
  }

  const current = periodOf(now);
  const today = localDateKey(now);
  const costs: FixedCostRow[] = [];
  const pending: PendingPayment[] = [];
  for (const row of rows) {
    const startsOn = periodOf(row.startsOn);
    const endsOn = row.endsOn ? periodOf(row.endsOn) : null;
    const months = row.archivedAt
      ? []
      : pendingPeriods({ startsOn, endsOn, paid: paidBy.get(row.id) ?? new Set(), current });
    costs.push({
      id: row.id,
      name: row.name,
      categoryId: row.categoryId,
      categoryName: row.category.name,
      amountCents: row.amountCents,
      dueDay: row.dueDay,
      startsOn,
      endsOn,
      archived: row.archivedAt !== null,
      pendingCount: months.length,
    });
    for (const period of months) {
      const dueDate = dueDateKey(period, row.dueDay);
      pending.push({
        fixedCostId: row.id,
        name: row.name,
        categoryName: row.category.name,
        period,
        dueDate,
        amountCents: row.amountCents,
        overdue: dueDate < today,
      });
    }
  }
  pending.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name));
  return { costs, pending };
}

// ───────────────────────── Resumen del periodo ─────────────────────────

/**
 * El estado de resultados de un periodo: las ventas netas y su costo salen de `getSalesSummary` (las mismas consultas de los
 * reportes, sobre todas las ventas); los gastos y otros ingresos, de los movimientos vigentes de Finanzas. La cuenta la hace
 * {@link computeFinanceSummary}.
 */
export async function getFinanceSummary(
  range: ReportRange,
  client: PrismaClient = db,
): Promise<FinanceSummary> {
  const [sales, groups] = await Promise.all([
    getSalesSummary(range, {}, true, client),
    client.financeEntry.groupBy({
      by: ["type", "categoryId"],
      where: { occurredAt: { gte: range.from, lte: range.to }, voidedAt: null },
      _sum: { amountCents: true },
    }),
  ]);
  const names = new Map(
    (
      await client.financeCategory.findMany({
        where: { id: { in: groups.map((group) => group.categoryId) } },
        select: { id: true, name: true },
      })
    ).map((category) => [category.id, category.name]),
  );
  const lines = (type: FinanceType) =>
    groups
      .filter((group) => group.type === type)
      .map((group) => ({
        categoryId: group.categoryId,
        name: names.get(group.categoryId) ?? group.categoryId,
        totalCents: group._sum.amountCents ?? 0,
      }));

  return computeFinanceSummary({
    revenueCents: sales.financial?.revenueCents ?? 0,
    costOfSalesCents: sales.financial?.costCents ?? 0,
    income: lines("INCOME"),
    expenses: lines("EXPENSE"),
  });
}
