import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { StockCountScope, StockCountStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { mulCents, sumCents } from "@/lib/money";

export const COUNT_ITEMS_PAGE_SIZE = 50;

export type CountRow = {
  id: string;
  status: StockCountStatus;
  scope: StockCountScope;
  scopeName: string;
  startedByName: string;
  createdAt: Date;
  items: number;
  counted: number;
  differences: number;
};

export async function listCounts(client: PrismaClient = db): Promise<CountRow[]> {
  const counts = await client.stockCount.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      startedBy: { select: { name: true } },
      items: { select: { expectedQty: true, countedQty: true } },
    },
  });
  const categoryIds = counts.flatMap((count) => (count.scopeRef ? [count.scopeRef] : []));
  const categories = categoryIds.length
    ? await client.category.findMany({
        where: { id: { in: categoryIds } },
        select: { id: true, name: true },
      })
    : [];
  const names = new Map(categories.map((category) => [category.id, category.name]));

  return counts.map((count) => ({
    id: count.id,
    status: count.status,
    scope: count.scope,
    scopeName: count.scopeRef ? (names.get(count.scopeRef) ?? "") : "",
    startedByName: count.startedBy.name,
    createdAt: count.createdAt,
    items: count.items.length,
    counted: count.items.filter((item) => item.countedQty > 0).length,
    differences: count.items.filter((item) => item.countedQty !== item.expectedQty).length,
  }));
}

export type CountSummary = {
  id: string;
  status: StockCountStatus;
  scope: StockCountScope;
  scopeName: string;
  startedByName: string;
  approvedByName: string | null;
  createdAt: Date;
  appliedAt: Date | null;
  items: number;
  counted: number;
  unitsExpected: number;
  unitsCounted: number;
  differences: number;
  /** Suma de (contado − sistema): positivo sobra, negativo falta. */
  netUnits: number;
  /** Lo mismo a costo promedio (solo si quien consulta puede ver costos). */
  valueCents: number | null;
};

export async function getCountSummary(
  id: string,
  options: { includeCost: boolean },
  client: PrismaClient = db,
): Promise<CountSummary | null> {
  const count = await client.stockCount.findUnique({
    where: { id },
    include: {
      startedBy: { select: { name: true } },
      approvedBy: { select: { name: true } },
      items: {
        select: {
          expectedQty: true,
          countedQty: true,
          variant: { select: { avgCostCents: true } },
        },
      },
    },
  });
  if (!count) {
    return null;
  }
  const scopeName = count.scopeRef
    ? ((await client.category.findUnique({ where: { id: count.scopeRef }, select: { name: true } }))
        ?.name ?? "")
    : "";
  const differing = count.items.filter((item) => item.countedQty !== item.expectedQty);
  return {
    id: count.id,
    status: count.status,
    scope: count.scope,
    scopeName,
    startedByName: count.startedBy.name,
    approvedByName: count.approvedBy?.name ?? null,
    createdAt: count.createdAt,
    appliedAt: count.appliedAt,
    items: count.items.length,
    counted: count.items.filter((item) => item.countedQty > 0).length,
    unitsExpected: count.items.reduce((sum, item) => sum + item.expectedQty, 0),
    unitsCounted: count.items.reduce((sum, item) => sum + item.countedQty, 0),
    differences: differing.length,
    netUnits: differing.reduce((sum, item) => sum + (item.countedQty - item.expectedQty), 0),
    valueCents: options.includeCost
      ? sumCents(
          differing.map((item) =>
            mulCents(item.variant.avgCostCents, item.countedQty - item.expectedQty),
          ),
        )
      : null,
  };
}

export type CountItemRow = {
  itemId: string;
  variantId: string;
  productName: string;
  label: string;
  sku: string;
  expectedQty: number;
  countedQty: number;
  difference: number;
  /** Lo que hay ahora en el sistema (puede haber cambiado desde que se abrió el conteo). */
  currentQty: number;
  valueCents: number | null;
};

export type CountItems = { rows: CountItemRow[]; total: number; page: number; pageSize: number };

export async function listCountItems(
  id: string,
  params: { q?: string; differencesOnly?: boolean; page?: number; includeCost: boolean },
  client: PrismaClient = db,
): Promise<CountItems> {
  const page = Math.max(1, Math.trunc(params.page ?? 1));
  const q = params.q?.trim();
  const where: Prisma.StockCountItemWhereInput = {
    stockCountId: id,
    ...(q
      ? {
          variant: {
            OR: [
              { sku: { contains: q, mode: "insensitive" } },
              { barcode: { contains: q } },
              { product: { name: { contains: q, mode: "insensitive" } } },
            ],
          },
        }
      : {}),
  };

  // "Solo diferencias" se decide con dos columnas de la misma fila: se hace en SQL para paginar bien.
  let ids: string[] | undefined;
  if (params.differencesOnly) {
    const rows = await client.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "StockCountItem"
      WHERE "stockCountId" = ${id} AND "countedQty" <> "expectedQty"
    `;
    ids = rows.map((row) => row.id);
  }
  const filter: Prisma.StockCountItemWhereInput = ids ? { ...where, id: { in: ids } } : where;

  const [total, items] = await Promise.all([
    client.stockCountItem.count({ where: filter }),
    client.stockCountItem.findMany({
      where: filter,
      orderBy: [{ variant: { product: { name: "asc" } } }, { variant: { sku: "asc" } }],
      skip: (page - 1) * COUNT_ITEMS_PAGE_SIZE,
      take: COUNT_ITEMS_PAGE_SIZE,
      include: {
        variant: {
          select: {
            sku: true,
            avgCostCents: true,
            product: { select: { name: true } },
            size: { select: { name: true } },
            color: { select: { name: true } },
          },
        },
      },
    }),
  ]);
  const levels = await client.stockLevel.groupBy({
    by: ["variantId"],
    where: { variantId: { in: items.map((item) => item.variantId) } },
    _sum: { onHand: true },
  });
  const current = new Map(levels.map((level) => [level.variantId, level._sum.onHand ?? 0]));

  return {
    rows: items.map((item) => {
      const difference = item.countedQty - item.expectedQty;
      return {
        itemId: item.id,
        variantId: item.variantId,
        productName: item.variant.product.name,
        label: [item.variant.size?.name, item.variant.color?.name].filter(Boolean).join(" · "),
        sku: item.variant.sku,
        expectedQty: item.expectedQty,
        countedQty: item.countedQty,
        difference,
        currentQty: current.get(item.variantId) ?? 0,
        valueCents: params.includeCost ? mulCents(item.variant.avgCostCents, difference) : null,
      };
    }),
    total,
    page,
    pageSize: COUNT_ITEMS_PAGE_SIZE,
  };
}
