import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { APP_TIME_ZONE } from "@/lib/dates";
import { db } from "@/lib/db";
import { descendantsOf } from "@/modules/catalog/service";
import type { ReportRange } from "@/modules/reports/ranges";

/**
 * Las consultas de los reportes. Cada una es una consulta tipada que agrega en la base (no trae filas para sumar en
 * memoria). Reglas que comparten:
 * - Solo cuentan las ventas COMPLETADAS (una anulada no vendió nada). Lo devuelto se resta por la fecha de la devolución.
 * - Las fechas se agrupan en hora de Honduras.
 * - `scope.onlySellerId` deja solo las ventas de esa persona (un cajero ve las suyas) y las devoluciones que ella hizo.
 * - Los costos y la utilidad solo salen si quien llama pasa `withCosts` (capacidad `report.financial`): sin ella ni
 *   siquiera se consultan, así que no pueden llegar a una pantalla ni a una exportación.
 * - El ingreso "sin ISV" de la utilidad es lo cobrado menos el ISV de las líneas (el de una devolución, en proporción
 *   a lo devuelto); el costo es el que se copió a cada línea al vender. Una devolución revendible devuelve su costo al
 *   estante; una dañada es merma y su costo se pierde.
 */

export type ReportScope = { onlySellerId?: string };

type Client = Pick<PrismaClient, "$queryRaw">;

const TZ = APP_TIME_ZONE;

/** Los enteros grandes de `SUM` llegan como `bigint`: las sumas de centavos caben de sobra en un `number`. */
function n(value: bigint | number | null | undefined): number {
  return Number(value ?? 0);
}

const saleScope = (scope: ReportScope) =>
  scope.onlySellerId ? Prisma.sql`AND s."sellerId" = ${scope.onlySellerId}` : Prisma.empty;
const returnScope = (scope: ReportScope) =>
  scope.onlySellerId ? Prisma.sql`AND rd."processedById" = ${scope.onlySellerId}` : Prisma.empty;

/** Lo mismo que `ROUND(refund × tax ÷ lineTotal)`: el ISV que iba dentro de lo devuelto. */
const RETURNED_TAX = Prisma.sql`ROUND(ri."refundCents"::numeric * si."taxCents" / NULLIF(si."lineTotalCents", 0))`;

// ───────────── Resumen ─────────────

export type SalesSummary = {
  tickets: number;
  /** Lo cobrado en las ventas del periodo (con ISV). */
  salesCents: number;
  /** El valor de lo devuelto en el periodo. */
  returnsCents: number;
  /** Ventas − devoluciones. */
  netCents: number;
  /** Ventas ÷ tickets, redondeado al centavo. */
  averageTicketCents: number;
  unitsSold: number;
  unitsReturned: number;
  /** Solo con permiso financiero; `null` si no. */
  financial: {
    /** Ingreso neto sin ISV: lo cobrado menos lo devuelto, sin el ISV de ambos. */
    revenueCents: number;
    costCents: number;
    profitCents: number;
    /** Utilidad ÷ ingreso, en puntos base (1000 = 10 %). 0 si no hubo ingreso. */
    marginBps: number;
  } | null;
};

export async function getSalesSummary(
  range: ReportRange,
  scope: ReportScope = {},
  withCosts = false,
  client: Client = db,
): Promise<SalesSummary> {
  const [sales] = await client.$queryRaw<
    { tickets: number; sales: bigint; units: bigint; tax: bigint; cost: bigint }[]
  >`
    SELECT COUNT(DISTINCT s."id")::int AS "tickets",
           COALESCE(SUM(si."lineTotalCents"), 0)::bigint AS "sales",
           COALESCE(SUM(si."quantity"), 0)::bigint AS "units",
           COALESCE(SUM(si."taxCents"), 0)::bigint AS "tax",
           COALESCE(SUM(si."unitCostCents" * si."quantity"), 0)::bigint AS "cost"
    FROM "Sale" s
    LEFT JOIN "SaleItem" si ON si."saleId" = s."id"
    WHERE s."status" = 'COMPLETED' AND s."createdAt" BETWEEN ${range.from} AND ${range.to}
      ${saleScope(scope)}
  `;
  const [returned] = await client.$queryRaw<
    { value: bigint; units: bigint; tax: bigint; cost: bigint }[]
  >`
    SELECT COALESCE(SUM(ri."refundCents"), 0)::bigint AS "value",
           COALESCE(SUM(ri."quantity"), 0)::bigint AS "units",
           COALESCE(SUM(${RETURNED_TAX}), 0)::bigint AS "tax",
           COALESCE(SUM(CASE WHEN ri."condition" = 'RESELLABLE' THEN si."unitCostCents" * ri."quantity" ELSE 0 END), 0)::bigint AS "cost"
    FROM "ReturnItem" ri
    JOIN "ReturnDoc" rd ON rd."id" = ri."returnId"
    JOIN "SaleItem" si ON si."id" = ri."saleItemId"
    WHERE rd."createdAt" BETWEEN ${range.from} AND ${range.to}
      ${returnScope(scope)}
  `;
  // El total de la venta es la suma de sus líneas (invariante #2); por eso se suman las líneas.
  const salesCents = n(sales?.sales);
  const returnsCents = n(returned?.value);
  const tickets = sales?.tickets ?? 0;
  const revenueCents = salesCents - n(sales?.tax) - (returnsCents - n(returned?.tax));
  const costCents = n(sales?.cost) - n(returned?.cost);
  const profitCents = revenueCents - costCents;
  return {
    tickets,
    salesCents,
    returnsCents,
    netCents: salesCents - returnsCents,
    averageTicketCents: tickets > 0 ? Math.round(salesCents / tickets) : 0,
    unitsSold: n(sales?.units),
    unitsReturned: n(returned?.units),
    financial: withCosts
      ? {
          revenueCents,
          costCents,
          profitCents,
          marginBps: revenueCents > 0 ? Math.round((profitCents * 10_000) / revenueCents) : 0,
        }
      : null,
  };
}

// ───────────── Por periodo, hora, cajero, método ─────────────

export type PeriodGranularity = "day" | "month";

export type SalesPeriodRow = {
  /** `2026-10-27` o `2026-10`. */
  key: string;
  tickets: number;
  salesCents: number;
  returnsCents: number;
  netCents: number;
};

export async function getSalesByPeriod(
  range: ReportRange,
  granularity: PeriodGranularity,
  scope: ReportScope = {},
  client: Client = db,
): Promise<SalesPeriodRow[]> {
  const format = granularity === "day" ? "YYYY-MM-DD" : "YYYY-MM";
  const sold = await client.$queryRaw<{ key: string; tickets: number; sales: bigint }[]>`
    SELECT to_char((s."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${TZ}, ${format}) AS "key",
           COUNT(DISTINCT s."id")::int AS "tickets",
           COALESCE(SUM(si."lineTotalCents"), 0)::bigint AS "sales"
    FROM "Sale" s
    JOIN "SaleItem" si ON si."saleId" = s."id"
    WHERE s."status" = 'COMPLETED' AND s."createdAt" BETWEEN ${range.from} AND ${range.to}
      ${saleScope(scope)}
    GROUP BY 1
  `;
  const returned = await client.$queryRaw<{ key: string; value: bigint }[]>`
    SELECT to_char((rd."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${TZ}, ${format}) AS "key",
           COALESCE(SUM(ri."refundCents"), 0)::bigint AS "value"
    FROM "ReturnItem" ri
    JOIN "ReturnDoc" rd ON rd."id" = ri."returnId"
    WHERE rd."createdAt" BETWEEN ${range.from} AND ${range.to}
      ${returnScope(scope)}
    GROUP BY 1
  `;
  const byKey = new Map<string, SalesPeriodRow>();
  const row = (key: string): SalesPeriodRow => {
    let found = byKey.get(key);
    if (!found) {
      found = { key, tickets: 0, salesCents: 0, returnsCents: 0, netCents: 0 };
      byKey.set(key, found);
    }
    return found;
  };
  for (const entry of sold) {
    const target = row(entry.key);
    target.tickets = entry.tickets;
    target.salesCents = n(entry.sales);
  }
  for (const entry of returned) {
    row(entry.key).returnsCents = n(entry.value);
  }
  return [...byKey.values()]
    .map((entry) => ({ ...entry, netCents: entry.salesCents - entry.returnsCents }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export type SalesHourRow = { hour: number; tickets: number; salesCents: number };

/** Las ventas por hora del día (hora de Honduras), de todo el periodo. */
export async function getSalesByHour(
  range: ReportRange,
  scope: ReportScope = {},
  client: Client = db,
): Promise<SalesHourRow[]> {
  const rows = await client.$queryRaw<{ hour: number; tickets: number; sales: bigint }[]>`
    SELECT EXTRACT(HOUR FROM (s."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${TZ})::int AS "hour",
           COUNT(DISTINCT s."id")::int AS "tickets",
           COALESCE(SUM(si."lineTotalCents"), 0)::bigint AS "sales"
    FROM "Sale" s
    JOIN "SaleItem" si ON si."saleId" = s."id"
    WHERE s."status" = 'COMPLETED' AND s."createdAt" BETWEEN ${range.from} AND ${range.to}
      ${saleScope(scope)}
    GROUP BY 1
    ORDER BY 1
  `;
  return rows.map((row) => ({ hour: row.hour, tickets: row.tickets, salesCents: n(row.sales) }));
}

export type SalesCashierRow = {
  sellerId: string;
  sellerName: string;
  tickets: number;
  salesCents: number;
  averageTicketCents: number;
};

export async function getSalesByCashier(
  range: ReportRange,
  scope: ReportScope = {},
  client: Client = db,
): Promise<SalesCashierRow[]> {
  const rows = await client.$queryRaw<
    { sellerId: string; name: string; tickets: number; sales: bigint }[]
  >`
    SELECT u."id" AS "sellerId", u."name" AS "name",
           COUNT(DISTINCT s."id")::int AS "tickets",
           COALESCE(SUM(si."lineTotalCents"), 0)::bigint AS "sales"
    FROM "Sale" s
    JOIN "SaleItem" si ON si."saleId" = s."id"
    JOIN "User" u ON u."id" = s."sellerId"
    WHERE s."status" = 'COMPLETED' AND s."createdAt" BETWEEN ${range.from} AND ${range.to}
      ${saleScope(scope)}
    GROUP BY u."id", u."name"
    ORDER BY "sales" DESC, u."name"
  `;
  return rows.map((row) => ({
    sellerId: row.sellerId,
    sellerName: row.name,
    tickets: row.tickets,
    salesCents: n(row.sales),
    averageTicketCents: row.tickets > 0 ? Math.round(n(row.sales) / row.tickets) : 0,
  }));
}

export type SalesMethodRow = {
  method: string;
  tickets: number;
  /** Lo recibido con ese método; en efectivo, ya sin el vuelto. */
  amountCents: number;
};

export async function getSalesByMethod(
  range: ReportRange,
  scope: ReportScope = {},
  client: Client = db,
): Promise<{ methods: SalesMethodRow[]; refunds: { method: string; amountCents: number }[] }> {
  const rows = await client.$queryRaw<{ method: string; tickets: number; amount: bigint }[]>`
    SELECT p."method"::text AS "method",
           COUNT(DISTINCT s."id")::int AS "tickets",
           COALESCE(SUM(p."amountCents"), 0)::bigint AS "amount"
    FROM "Payment" p
    JOIN "Sale" s ON s."id" = p."saleId"
    WHERE s."status" = 'COMPLETED' AND s."createdAt" BETWEEN ${range.from} AND ${range.to}
      ${saleScope(scope)}
    GROUP BY 1
    ORDER BY "amount" DESC
  `;
  const [change] = await client.$queryRaw<{ change: bigint }[]>`
    SELECT COALESCE(SUM(s."changeCents"), 0)::bigint AS "change"
    FROM "Sale" s
    WHERE s."status" = 'COMPLETED' AND s."createdAt" BETWEEN ${range.from} AND ${range.to}
      ${saleScope(scope)}
  `;
  const refunds = await client.$queryRaw<{ method: string; amount: bigint }[]>`
    SELECT rd."refundMethod"::text AS "method", COALESCE(SUM(rd."refundCents"), 0)::bigint AS "amount"
    FROM "ReturnDoc" rd
    WHERE rd."createdAt" BETWEEN ${range.from} AND ${range.to} AND rd."refundCents" > 0
      ${returnScope(scope)}
    GROUP BY 1
    ORDER BY 1
  `;
  return {
    methods: rows.map((row) => ({
      method: row.method,
      tickets: row.tickets,
      amountCents: n(row.amount) - (row.method === "CASH" ? n(change?.change) : 0),
    })),
    refunds: refunds.map((row) => ({ method: row.method, amountCents: n(row.amount) })),
  };
}

// ───────────── Por categoría y marca ─────────────

export type SalesDimension = "category" | "brand";

export type SalesDimensionRow = {
  key: string;
  name: string;
  units: number;
  soldCents: number;
  returnedCents: number;
  netCents: number;
  /** Solo con permiso financiero. */
  financial: {
    revenueCents: number;
    costCents: number;
    profitCents: number;
    marginBps: number;
  } | null;
};

export async function getSalesByDimension(
  range: ReportRange,
  dimension: SalesDimension,
  scope: ReportScope = {},
  withCosts = false,
  client: Client = db,
): Promise<SalesDimensionRow[]> {
  const joinSold =
    dimension === "category"
      ? Prisma.sql`JOIN "Category" d ON d."id" = p."categoryId"`
      : Prisma.sql`LEFT JOIN "Brand" d ON d."id" = p."brandId"`;
  const sold = await client.$queryRaw<
    {
      key: string | null;
      name: string | null;
      units: bigint;
      sales: bigint;
      tax: bigint;
      cost: bigint;
    }[]
  >`
    SELECT d."id" AS "key", d."name" AS "name",
           COALESCE(SUM(si."quantity"), 0)::bigint AS "units",
           COALESCE(SUM(si."lineTotalCents"), 0)::bigint AS "sales",
           COALESCE(SUM(si."taxCents"), 0)::bigint AS "tax",
           COALESCE(SUM(si."unitCostCents" * si."quantity"), 0)::bigint AS "cost"
    FROM "SaleItem" si
    JOIN "Sale" s ON s."id" = si."saleId"
    JOIN "Variant" v ON v."id" = si."variantId"
    JOIN "Product" p ON p."id" = v."productId"
    ${joinSold}
    WHERE s."status" = 'COMPLETED' AND s."createdAt" BETWEEN ${range.from} AND ${range.to}
      ${saleScope(scope)}
    GROUP BY d."id", d."name"
  `;
  const joinReturned =
    dimension === "category"
      ? Prisma.sql`JOIN "Category" d ON d."id" = p."categoryId"`
      : Prisma.sql`LEFT JOIN "Brand" d ON d."id" = p."brandId"`;
  const returned = await client.$queryRaw<
    { key: string | null; value: bigint; units: bigint; tax: bigint; cost: bigint }[]
  >`
    SELECT d."id" AS "key",
           COALESCE(SUM(ri."refundCents"), 0)::bigint AS "value",
           COALESCE(SUM(ri."quantity"), 0)::bigint AS "units",
           COALESCE(SUM(${RETURNED_TAX}), 0)::bigint AS "tax",
           COALESCE(SUM(CASE WHEN ri."condition" = 'RESELLABLE' THEN si."unitCostCents" * ri."quantity" ELSE 0 END), 0)::bigint AS "cost"
    FROM "ReturnItem" ri
    JOIN "ReturnDoc" rd ON rd."id" = ri."returnId"
    JOIN "SaleItem" si ON si."id" = ri."saleItemId"
    JOIN "Variant" v ON v."id" = si."variantId"
    JOIN "Product" p ON p."id" = v."productId"
    ${joinReturned}
    WHERE rd."createdAt" BETWEEN ${range.from} AND ${range.to}
      ${returnScope(scope)}
    GROUP BY d."id"
  `;
  const noBrand = "none";
  const returnedByKey = new Map(returned.map((row) => [row.key ?? noBrand, row]));
  const keys = new Set([
    ...sold.map((row) => row.key ?? noBrand),
    ...returned.map((row) => row.key ?? noBrand),
  ]);
  const names = new Map(sold.map((row) => [row.key ?? noBrand, row.name ?? ""]));
  const soldByKey = new Map(sold.map((row) => [row.key ?? noBrand, row]));
  const rows: SalesDimensionRow[] = [];
  for (const key of keys) {
    const s = soldByKey.get(key);
    const r = returnedByKey.get(key);
    const soldCents = n(s?.sales);
    const returnedCents = n(r?.value);
    const revenueCents = soldCents - n(s?.tax) - (returnedCents - n(r?.tax));
    const costCents = n(s?.cost) - n(r?.cost);
    const profitCents = revenueCents - costCents;
    rows.push({
      key,
      name: names.get(key) ?? (key === noBrand ? "" : key),
      units: n(s?.units) - n(r?.units),
      soldCents,
      returnedCents,
      netCents: soldCents - returnedCents,
      financial: withCosts
        ? {
            revenueCents,
            costCents,
            profitCents,
            marginBps: revenueCents > 0 ? Math.round((profitCents * 10_000) / revenueCents) : 0,
          }
        : null,
    });
  }
  // Las categorías que solo tuvieron devoluciones no traen nombre de las ventas: se completan
  const missing = rows.filter((row) => row.name === "" && row.key !== noBrand);
  if (missing.length > 0 && dimension === "category") {
    const found = await db.category.findMany({
      where: { id: { in: missing.map((row) => row.key) } },
      select: { id: true, name: true },
    });
    const byId = new Map(found.map((category) => [category.id, category.name]));
    for (const row of missing) {
      row.name = byId.get(row.key) ?? row.key;
    }
  } else if (missing.length > 0) {
    const found = await db.brand.findMany({
      where: { id: { in: missing.map((row) => row.key) } },
      select: { id: true, name: true },
    });
    const byId = new Map(found.map((brand) => [brand.id, brand.name]));
    for (const row of missing) {
      row.name = byId.get(row.key) ?? row.key;
    }
  }
  return rows.sort((a, b) => b.netCents - a.netCents || a.name.localeCompare(b.name));
}

// ───────────── Productos: más y menos vendidos, rotación ─────────────

export type ProductSalesRow = {
  productId: string;
  code: string;
  name: string;
  categoryName: string;
  unitsSold: number;
  unitsReturned: number;
  /** Prendas vendidas menos devueltas. */
  netUnits: number;
  soldCents: number;
  onHand: number;
  /** Veces que rotó: vendidas netas ÷ existencia actual (0 si no hay existencia). */
  rotation: number;
  /** Días que alcanza la existencia al ritmo del periodo (`null` si no se vendió nada). */
  daysOfStock: number | null;
};

/** Todos los productos activos con lo vendido en el periodo y la existencia de hoy; quien llama ordena y recorta. */
export async function listProductSales(
  range: ReportRange,
  days: number,
  scope: ReportScope = {},
  client: Client = db,
): Promise<ProductSalesRow[]> {
  const rows = await client.$queryRaw<
    {
      productId: string;
      code: string;
      name: string;
      category: string;
      units: bigint;
      sales: bigint;
      onHand: bigint;
    }[]
  >`
    SELECT p."id" AS "productId", p."code" AS "code", p."name" AS "name", c."name" AS "category",
           COALESCE(sold."units", 0)::bigint AS "units",
           COALESCE(sold."sales", 0)::bigint AS "sales",
           COALESCE(stock."onHand", 0)::bigint AS "onHand"
    FROM "Product" p
    JOIN "Category" c ON c."id" = p."categoryId"
    LEFT JOIN (
      SELECT v."productId", SUM(si."quantity") AS "units", SUM(si."lineTotalCents") AS "sales"
      FROM "SaleItem" si
      JOIN "Sale" s ON s."id" = si."saleId"
      JOIN "Variant" v ON v."id" = si."variantId"
      WHERE s."status" = 'COMPLETED' AND s."createdAt" BETWEEN ${range.from} AND ${range.to}
        ${saleScope(scope)}
      GROUP BY v."productId"
    ) sold ON sold."productId" = p."id"
    LEFT JOIN (
      SELECT v."productId", SUM(GREATEST(sl."onHand", 0)) AS "onHand"
      FROM "StockLevel" sl
      JOIN "Variant" v ON v."id" = sl."variantId"
      GROUP BY v."productId"
    ) stock ON stock."productId" = p."id"
    WHERE p."archivedAt" IS NULL
  `;
  const returned = await client.$queryRaw<{ productId: string; units: bigint }[]>`
    SELECT v."productId" AS "productId", COALESCE(SUM(ri."quantity"), 0)::bigint AS "units"
    FROM "ReturnItem" ri
    JOIN "ReturnDoc" rd ON rd."id" = ri."returnId"
    JOIN "SaleItem" si ON si."id" = ri."saleItemId"
    JOIN "Variant" v ON v."id" = si."variantId"
    WHERE rd."createdAt" BETWEEN ${range.from} AND ${range.to}
      ${returnScope(scope)}
    GROUP BY v."productId"
  `;
  const returnedBy = new Map(returned.map((row) => [row.productId, n(row.units)]));
  return rows.map((row) => {
    const unitsSold = n(row.units);
    const unitsReturned = returnedBy.get(row.productId) ?? 0;
    const netUnits = unitsSold - unitsReturned;
    const onHand = n(row.onHand);
    return {
      productId: row.productId,
      code: row.code,
      name: row.name,
      categoryName: row.category,
      unitsSold,
      unitsReturned,
      netUnits,
      soldCents: n(row.sales),
      onHand,
      rotation: onHand > 0 ? Math.round((netUnits / onHand) * 100) / 100 : 0,
      daysOfStock: netUnits > 0 ? Math.round(onHand / (netUnits / Math.max(1, days))) : null,
    };
  });
}

/** Los productos más (o menos) vendidos. Los menos vendidos solo cuentan los que tienen existencia. */
export function rankProducts(
  rows: readonly ProductSalesRow[],
  order: "best" | "worst",
  limit: number,
): ProductSalesRow[] {
  const pool =
    order === "best"
      ? rows.filter((row) => row.netUnits > 0)
      : rows.filter((row) => row.onHand > 0);
  const sorted = [...pool].sort((a, b) =>
    order === "best"
      ? b.netUnits - a.netUnits || b.soldCents - a.soldCents || a.name.localeCompare(b.name)
      : a.netUnits - b.netUnits || b.onHand - a.onHand || a.name.localeCompare(b.name),
  );
  return sorted.slice(0, limit);
}

// ───────────── Matriz talla × color ─────────────

export type SizeColorMatrix = {
  sizes: { id: string; name: string }[];
  colors: { id: string; name: string; hex: string | null }[];
  /** Prendas vendidas por talla y color (sin las devueltas). */
  cells: { sizeId: string; colorId: string; units: number }[];
  totalUnits: number;
};

export async function getSizeColorMatrix(
  range: ReportRange,
  scope: ReportScope = {},
  categoryId?: string,
  client: Client & Pick<PrismaClient, "category"> = db,
): Promise<SizeColorMatrix> {
  let categoryFilter = Prisma.empty;
  if (categoryId) {
    const all = await client.category.findMany({ select: { id: true, parentId: true } });
    const ids = [categoryId, ...descendantsOf(all, categoryId)];
    categoryFilter = Prisma.sql`AND p."categoryId" IN (${Prisma.join(ids)})`;
  }
  const rows = await client.$queryRaw<
    {
      sizeId: string;
      sizeName: string;
      sizeOrder: number;
      colorId: string;
      colorName: string;
      hex: string | null;
      colorOrder: number;
      units: bigint;
    }[]
  >`
    SELECT z."id" AS "sizeId", z."name" AS "sizeName", z."sortOrder" AS "sizeOrder",
           k."id" AS "colorId", k."name" AS "colorName", k."hex" AS "hex", k."sortOrder" AS "colorOrder",
           SUM(si."quantity")::bigint AS "units"
    FROM "SaleItem" si
    JOIN "Sale" s ON s."id" = si."saleId"
    JOIN "Variant" v ON v."id" = si."variantId"
    JOIN "Product" p ON p."id" = v."productId"
    JOIN "Size" z ON z."id" = v."sizeId"
    JOIN "Color" k ON k."id" = v."colorId"
    WHERE s."status" = 'COMPLETED' AND s."createdAt" BETWEEN ${range.from} AND ${range.to}
      ${saleScope(scope)}
      ${categoryFilter}
    GROUP BY z."id", z."name", z."sortOrder", k."id", k."name", k."hex", k."sortOrder"
  `;
  const sizes = new Map<string, { id: string; name: string; order: number }>();
  const colors = new Map<string, { id: string; name: string; hex: string | null; order: number }>();
  let totalUnits = 0;
  for (const row of rows) {
    sizes.set(row.sizeId, { id: row.sizeId, name: row.sizeName, order: row.sizeOrder });
    colors.set(row.colorId, {
      id: row.colorId,
      name: row.colorName,
      hex: row.hex,
      order: row.colorOrder,
    });
    totalUnits += n(row.units);
  }
  return {
    sizes: [...sizes.values()]
      .sort((a, b) => a.order - b.order)
      .map(({ id, name }) => ({ id, name })),
    colors: [...colors.values()]
      .sort((a, b) => a.order - b.order)
      .map(({ id, name, hex }) => ({ id, name, hex })),
    cells: rows.map((row) => ({ sizeId: row.sizeId, colorId: row.colorId, units: n(row.units) })),
    totalUnits,
  };
}

// ───────────── Cierres de caja ─────────────

export type CashClosingRow = {
  id: string;
  closedAt: Date;
  terminalName: string;
  userName: string;
  status: "CLOSED_PENDING_APPROVAL" | "CLOSED";
  expectedCents: number;
  countedCents: number;
  differenceCents: number;
};

export type CashClosings = {
  rows: CashClosingRow[];
  /** Cuántos cierres, cuántos con diferencia y cuánto faltó y sobró en total. */
  count: number;
  withDifference: number;
  shortCents: number;
  overCents: number;
};

export async function getCashClosings(
  range: ReportRange,
  client: Client = db,
): Promise<CashClosings> {
  const rows = await client.$queryRaw<
    {
      id: string;
      closedAt: Date;
      terminal: string;
      user: string;
      status: "CLOSED_PENDING_APPROVAL" | "CLOSED";
      expected: number;
      counted: number;
      difference: number;
    }[]
  >`
    SELECT cs."id" AS "id", cs."closedAt" AS "closedAt", t."name" AS "terminal", u."name" AS "user",
           cs."status"::text AS "status", cs."expectedCashCents" AS "expected",
           cs."countedCashCents" AS "counted", cs."differenceCents" AS "difference"
    FROM "CashSession" cs
    JOIN "Terminal" t ON t."id" = cs."terminalId"
    JOIN "User" u ON u."id" = cs."userId"
    WHERE cs."status" <> 'OPEN' AND cs."closedAt" BETWEEN ${range.from} AND ${range.to}
    ORDER BY cs."closedAt" DESC
  `;
  const mapped = rows.map((row) => ({
    id: row.id,
    closedAt: row.closedAt,
    terminalName: row.terminal,
    userName: row.user,
    status: row.status,
    expectedCents: row.expected,
    countedCents: row.counted,
    differenceCents: row.difference,
  }));
  return {
    rows: mapped,
    count: mapped.length,
    withDifference: mapped.filter((row) => row.differenceCents !== 0).length,
    shortCents: mapped
      .filter((row) => row.differenceCents < 0)
      .reduce((sum, row) => sum - row.differenceCents, 0),
    overCents: mapped
      .filter((row) => row.differenceCents > 0)
      .reduce((sum, row) => sum + row.differenceCents, 0),
  };
}

// ───────────── Inventario: sin movimiento y valoración (solo con permiso financiero) ─────────────

export type DeadStockRow = {
  variantId: string;
  sku: string;
  productName: string;
  sizeName: string | null;
  colorName: string | null;
  onHand: number;
  /** La última venta de esa prenda (`null` si nunca se vendió). */
  lastSaleAt: Date | null;
  costValueCents: number;
};

/** Prendas con existencia que no se venden desde hace `days` días (o nunca), las que más capital tienen primero. */
export async function getDeadStock(
  days: number,
  now: Date = new Date(),
  limit = 200,
  client: Client = db,
): Promise<{ rows: DeadStockRow[]; totalCostValueCents: number; total: number }> {
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const rows = await client.$queryRaw<
    {
      variantId: string;
      sku: string;
      productName: string;
      sizeName: string | null;
      colorName: string | null;
      onHand: bigint;
      lastSale: Date | null;
      cost: bigint;
    }[]
  >`
    SELECT v."id" AS "variantId", v."sku" AS "sku", p."name" AS "productName",
           z."name" AS "sizeName", k."name" AS "colorName",
           stock."onHand"::bigint AS "onHand", last."lastSale" AS "lastSale",
           (stock."onHand" * v."avgCostCents")::bigint AS "cost"
    FROM "Variant" v
    JOIN "Product" p ON p."id" = v."productId"
    LEFT JOIN "Size" z ON z."id" = v."sizeId"
    LEFT JOIN "Color" k ON k."id" = v."colorId"
    JOIN (
      SELECT "variantId", SUM("onHand") AS "onHand" FROM "StockLevel" GROUP BY "variantId" HAVING SUM("onHand") > 0
    ) stock ON stock."variantId" = v."id"
    LEFT JOIN (
      SELECT si."variantId", MAX(s."createdAt") AS "lastSale"
      FROM "SaleItem" si JOIN "Sale" s ON s."id" = si."saleId"
      WHERE s."status" = 'COMPLETED'
      GROUP BY si."variantId"
    ) last ON last."variantId" = v."id"
    WHERE v."archivedAt" IS NULL AND p."archivedAt" IS NULL
      AND (last."lastSale" IS NULL OR last."lastSale" < ${cutoff})
    ORDER BY "cost" DESC, p."name", v."sku"
  `;
  const all = rows.map((row) => ({
    variantId: row.variantId,
    sku: row.sku,
    productName: row.productName,
    sizeName: row.sizeName,
    colorName: row.colorName,
    onHand: n(row.onHand),
    lastSaleAt: row.lastSale,
    costValueCents: n(row.cost),
  }));
  return {
    rows: all.slice(0, limit),
    totalCostValueCents: all.reduce((sum, row) => sum + row.costValueCents, 0),
    total: all.length,
  };
}

export type ValuationRow = {
  categoryId: string;
  categoryName: string;
  units: number;
  costValueCents: number;
  retailValueCents: number;
};

/** Lo que vale la existencia de hoy por categoría, a costo promedio y a precio de venta (solo existencias positivas). */
export async function getInventoryValuation(client: Client = db): Promise<{
  rows: ValuationRow[];
  units: number;
  costValueCents: number;
  retailValueCents: number;
}> {
  const rows = await client.$queryRaw<
    { categoryId: string; name: string; units: bigint; cost: bigint; retail: bigint }[]
  >`
    SELECT c."id" AS "categoryId", c."name" AS "name",
           COALESCE(SUM(sl."onHand"), 0)::bigint AS "units",
           COALESCE(SUM(sl."onHand" * v."avgCostCents"), 0)::bigint AS "cost",
           COALESCE(SUM(sl."onHand" * COALESCE(v."priceCents", p."basePriceCents")), 0)::bigint AS "retail"
    FROM "StockLevel" sl
    JOIN "Variant" v ON v."id" = sl."variantId"
    JOIN "Product" p ON p."id" = v."productId"
    JOIN "Category" c ON c."id" = p."categoryId"
    WHERE sl."onHand" > 0 AND v."archivedAt" IS NULL AND p."archivedAt" IS NULL
    GROUP BY c."id", c."name"
    ORDER BY "cost" DESC, c."name"
  `;
  const mapped = rows.map((row) => ({
    categoryId: row.categoryId,
    categoryName: row.name,
    units: n(row.units),
    costValueCents: n(row.cost),
    retailValueCents: n(row.retail),
  }));
  return {
    rows: mapped,
    units: mapped.reduce((sum, row) => sum + row.units, 0),
    costValueCents: mapped.reduce((sum, row) => sum + row.costValueCents, 0),
    retailValueCents: mapped.reduce((sum, row) => sum + row.retailValueCents, 0),
  };
}
