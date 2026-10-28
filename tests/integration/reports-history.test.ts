import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { expectedCashCents } from "@/modules/cash/expected";
import { loadCashTotals } from "@/modules/cash/service";
import { findStockDiscrepancies } from "@/modules/inventory/reconcile";
import {
  getCashClosings,
  getDeadStock,
  getInventoryValuation,
  getSalesByCashier,
  getSalesByDimension,
  getSalesByHour,
  getSalesByMethod,
  getSalesByPeriod,
  getSalesSummary,
  getSizeColorMatrix,
  listProductSales,
  rankProducts,
} from "@/modules/reports/queries";
import { daysInRange, type ReportRange } from "@/modules/reports/ranges";
import { findOverReturns } from "@/modules/returns/reconcile";
import { startOfLocalDay, addLocalDays, endOfLocalDay, localDateKey } from "@/lib/dates";

import { generateHistory, type HistorySummary } from "../../prisma/seed/history";
import { runSeed } from "../../prisma/seed/run-seed";

import { closeDatabase, resetDatabase, testDb } from "./helpers/db";

/**
 * Un año de ventas generado (≈20 000 líneas): los libros siguen cuadrados, cada reporte se reconcilia con el detalle y
 * ninguno tarda más de 2 s (criterio de aceptación de la Fase 5).
 */

let history: HistorySummary;
let generationMs = 0;
const timings: Record<string, number> = {};

const yesterday = startOfLocalDay(addLocalDays(new Date(), -1));
const range = (from: Date, to: Date): ReportRange => ({
  from: startOfLocalDay(from),
  to: endOfLocalDay(to),
  fromKey: localDateKey(from),
  toKey: localDateKey(to),
  preset: null,
});
const wholeYear = range(addLocalDays(yesterday, -364), yesterday);
const lastMonth = range(addLocalDays(yesterday, -29), yesterday);

async function timed<T>(label: string, run: () => Promise<T>): Promise<T> {
  const started = performance.now();
  const result = await run();
  timings[label] = Math.round(performance.now() - started);
  return result;
}

beforeAll(async () => {
  await resetDatabase();
  await runSeed(testDb);
  const started = performance.now();
  history = await generateHistory(testDb, { seed: 1234 });
  generationMs = Math.round(performance.now() - started);
}, 600_000);

afterAll(async () => {
  console.info(`historia: ${generationMs} ms; reportes (ms): ${JSON.stringify(timings)}`);
  await db.$disconnect();
  await closeDatabase();
});

describe("the generated year", () => {
  it("is big enough to mean something", () => {
    expect(history.lines).toBeGreaterThan(15_000);
    expect(history.sales).toBeGreaterThan(5_000);
    expect(history.returns).toBeGreaterThan(100);
    expect(history.sessions).toBeGreaterThan(300);
    expect(daysInRange(wholeYear)).toBe(365);
  });

  it("leaves the books straight (#1, #2, #3, #4, #6)", async () => {
    expect(await findStockDiscrepancies(testDb)).toEqual([]);
    expect(await testDb.stockLevel.count({ where: { onHand: { lt: 0 } } })).toBe(0);
    expect(await findOverReturns(testDb)).toEqual([]);

    // #2: Σ pagos − vuelto = total y Σ líneas = total (en una sola consulta, no venta por venta)
    const broken = await testDb.$queryRaw<{ id: string }[]>`
      SELECT s."id" FROM "Sale" s
      LEFT JOIN (SELECT "saleId", SUM("amountCents") AS "paid" FROM "Payment" GROUP BY "saleId") p ON p."saleId" = s."id"
      LEFT JOIN (SELECT "saleId", SUM("lineTotalCents") AS "lines" FROM "SaleItem" GROUP BY "saleId") i ON i."saleId" = s."id"
      WHERE COALESCE(p."paid", 0) - s."changeCents" <> s."totalCents"
         OR COALESCE(i."lines", 0) <> s."totalCents"
         OR s."paidCents" <> COALESCE(p."paid", 0)
      LIMIT 5
    `;
    expect(broken).toEqual([]);

    // #4: tickets y devoluciones correlativos, con el contador al día
    for (const [key, table] of [
      ["SALE", "Sale"],
      ["RETURN", "ReturnDoc"],
    ] as const) {
      const [row] = await testDb.$queryRawUnsafe<{ count: number; max: number }[]>(
        `SELECT COUNT(*)::int AS "count", MAX(CAST(split_part("number", '-', 2) AS int))::int AS "max" FROM "${table}"`,
      );
      const counter = await testDb.documentCounter.findUniqueOrThrow({ where: { key } });
      expect(row?.max).toBe(row?.count);
      expect(counter.nextValue).toBe((row?.count ?? 0) + 1);
    }

    // #6: lo que se guardó al cerrar cada turno es lo que dice la fórmula
    const sessions = await testDb.cashSession.findMany({
      orderBy: { openedAt: "asc" },
      select: { id: true, expectedCashCents: true, countedCashCents: true, differenceCents: true },
    });
    for (const session of sessions.filter((_, index) => index % 12 === 0)) {
      expect(expectedCashCents(await loadCashTotals(testDb, session.id))).toBe(
        session.expectedCashCents,
      );
      expect(session.differenceCents).toBe(
        (session.countedCashCents ?? 0) - (session.expectedCashCents ?? 0),
      );
    }
  });

  it("cannot be loaded twice", async () => {
    await expect(generateHistory(testDb)).rejects.toThrow(/ya está cargada/);
  });
});

describe("every report reconciles with the detail", () => {
  for (const [label, period] of [
    ["the whole year", wholeYear],
    ["the last 30 days", lastMonth],
    ["one day", range(addLocalDays(yesterday, -10), addLocalDays(yesterday, -10))],
  ] as const) {
    it(`over ${label}`, async () => {
      const summary = await getSalesSummary(period, {}, true);
      expect(summary.salesCents).toBeGreaterThan(0);

      // contra el detalle de ventas (suma directa de las ventas completadas)
      const direct = await testDb.sale.aggregate({
        where: { status: "COMPLETED", createdAt: { gte: period.from, lte: period.to } },
        _sum: { totalCents: true, taxCents: true },
        _count: { _all: true },
      });
      expect(summary.salesCents).toBe(direct._sum.totalCents ?? 0);
      expect(summary.tickets).toBe(direct._count._all);
      const units = await testDb.saleItem.aggregate({
        where: { sale: { status: "COMPLETED", createdAt: { gte: period.from, lte: period.to } } },
        _sum: { quantity: true },
      });
      expect(summary.unitsSold).toBe(units._sum.quantity ?? 0);
      const refunds = await testDb.returnItem.aggregate({
        where: { returnDoc: { createdAt: { gte: period.from, lte: period.to } } },
        _sum: { refundCents: true, quantity: true },
      });
      expect(summary.returnsCents).toBe(refunds._sum.refundCents ?? 0);
      expect(summary.unitsReturned).toBe(refunds._sum.quantity ?? 0);
      expect(summary.netCents).toBe(summary.salesCents - summary.returnsCents);

      // cada desglose suma lo mismo que el resumen
      const byDay = await getSalesByPeriod(period, "day");
      expect(byDay.reduce((sum, row) => sum + row.salesCents, 0)).toBe(summary.salesCents);
      expect(byDay.reduce((sum, row) => sum + row.returnsCents, 0)).toBe(summary.returnsCents);
      expect(byDay.reduce((sum, row) => sum + row.tickets, 0)).toBe(summary.tickets);
      const byMonth = await getSalesByPeriod(period, "month");
      expect(byMonth.reduce((sum, row) => sum + row.netCents, 0)).toBe(summary.netCents);
      expect((await getSalesByHour(period)).reduce((sum, row) => sum + row.salesCents, 0)).toBe(
        summary.salesCents,
      );
      expect((await getSalesByCashier(period)).reduce((sum, row) => sum + row.salesCents, 0)).toBe(
        summary.salesCents,
      );
      const methods = await getSalesByMethod(period);
      expect(methods.methods.reduce((sum, row) => sum + row.amountCents, 0)).toBe(
        summary.salesCents,
      );
      for (const dimension of ["category", "brand"] as const) {
        const rows = await getSalesByDimension(period, dimension, {}, true);
        expect(rows.reduce((sum, row) => sum + row.soldCents, 0)).toBe(summary.salesCents);
        expect(rows.reduce((sum, row) => sum + row.returnedCents, 0)).toBe(summary.returnsCents);
        expect(rows.reduce((sum, row) => sum + row.units, 0)).toBe(
          summary.unitsSold - summary.unitsReturned,
        );
        expect(rows.reduce((sum, row) => sum + (row.financial?.profitCents ?? 0), 0)).toBe(
          summary.financial?.profitCents,
        );
        expect(rows.reduce((sum, row) => sum + (row.financial?.revenueCents ?? 0), 0)).toBe(
          summary.financial?.revenueCents,
        );
      }
      const products = await listProductSales(period, daysInRange(period));
      expect(products.reduce((sum, row) => sum + row.unitsSold, 0)).toBe(summary.unitsSold);
      expect(products.reduce((sum, row) => sum + row.soldCents, 0)).toBe(summary.salesCents);
      expect(products.reduce((sum, row) => sum + row.unitsReturned, 0)).toBeLessThanOrEqual(
        summary.unitsReturned,
      );
      const matrix = await getSizeColorMatrix(period);
      expect(matrix.totalUnits).toBeLessThanOrEqual(summary.unitsSold);
    });
  }

  it("limits a cashier to their own sales", async () => {
    const cashier = await testDb.user.findFirstOrThrow({ where: { role: "CASHIER" } });
    const mine = await getSalesSummary(wholeYear, { onlySellerId: cashier.id }, false);
    const direct = await testDb.sale.aggregate({
      where: {
        status: "COMPLETED",
        sellerId: cashier.id,
        createdAt: { gte: wholeYear.from, lte: wholeYear.to },
      },
      _sum: { totalCents: true },
      _count: { _all: true },
    });
    expect(mine.salesCents).toBe(direct._sum.totalCents);
    expect(mine.tickets).toBe(direct._count._all);
    const everyone = await getSalesSummary(wholeYear, {}, false);
    expect(mine.salesCents).toBeLessThan(everyone.salesCents);
    expect(
      (await getSalesByCashier(wholeYear, { onlySellerId: cashier.id })).map((row) => row.sellerId),
    ).toEqual([cashier.id]);
  });

  it("never carries costs, profit or margins when the permission is not given", async () => {
    const cashier = await testDb.user.findFirstOrThrow({ where: { role: "CASHIER" } });
    const scope = { onlySellerId: cashier.id };
    const results = [
      await getSalesSummary(wholeYear, scope, false),
      await getSalesByDimension(wholeYear, "category", scope, false),
      await getSalesByDimension(wholeYear, "brand", scope, false),
      await listProductSales(wholeYear, 365, scope),
    ];
    const text = JSON.stringify(results);
    for (const word of [
      "costCents",
      "profitCents",
      "marginBps",
      "revenueCents",
      "costValue",
      "avgCost",
    ]) {
      expect(text, word).not.toContain(word);
    }
  });
});

describe("every report loads in under two seconds", () => {
  it("over the whole year", async () => {
    await timed("summary", () => getSalesSummary(wholeYear, {}, true));
    await timed("byDay", () => getSalesByPeriod(wholeYear, "day"));
    await timed("byMonth", () => getSalesByPeriod(wholeYear, "month"));
    await timed("byHour", () => getSalesByHour(wholeYear));
    await timed("byCashier", () => getSalesByCashier(wholeYear));
    await timed("byMethod", () => getSalesByMethod(wholeYear));
    await timed("byCategory", () => getSalesByDimension(wholeYear, "category", {}, true));
    await timed("byBrand", () => getSalesByDimension(wholeYear, "brand", {}, true));
    const products = await timed("products", () => listProductSales(wholeYear, 365));
    await timed("matrix", () => getSizeColorMatrix(wholeYear));
    await timed("closings", () => getCashClosings(wholeYear));
    await timed("deadStock", () => getDeadStock(90));
    await timed("valuation", () => getInventoryValuation());
    expect(rankProducts(products, "best", 5)).toHaveLength(5);
    expect(rankProducts(products, "worst", 5).length).toBeGreaterThan(0);
    for (const [label, ms] of Object.entries(timings)) {
      expect(ms, label).toBeLessThan(2000);
    }
  });
});
