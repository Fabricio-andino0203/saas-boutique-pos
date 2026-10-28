import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addLocalDays } from "@/lib/dates";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { openCashSession } from "@/modules/cash/service";
import { recordMovement } from "@/modules/inventory/service";
import { reportAccess } from "@/modules/reports/access";
import { getDashboard } from "@/modules/reports/dashboard";
import { processReturn } from "@/modules/returns/service";
import { completeSale } from "@/modules/sales/service";

import { closeDatabase, resetDatabase, testDb } from "./helpers/db";

/**
 * El dashboard del día se reconcilia con el detalle: cada cifra es una suma de las ventas (y de sus líneas) de hoy que
 * aquí se vuelve a calcular a mano contra la base.
 */

type Actor = { id: string; role: Role };
let cashier: Actor;
let manager: Actor;
const variants: Record<string, string> = {};

beforeAll(async () => {
  await resetDatabase();
  const make = async (username: string, role: Role): Promise<Actor> => {
    const user = await testDb.user.create({
      data: { name: `Nombre ${username}`, username, passwordHash: "x", role },
    });
    return { id: user.id, role };
  };
  const owner = await make("owner", "OWNER");
  manager = await make("manager", "MANAGER");
  cashier = await make("cashier", "CASHIER");
  const location = await testDb.location.create({
    data: { code: "MAIN", name: "Tienda principal", isDefault: true },
  });
  await testDb.terminal.create({ data: { name: "Caja 1", locationId: location.id } });
  const category = await testDb.category.create({ data: { name: "Mujer", slug: "mujer" } });
  for (const [key, price, cost] of [
    ["A", 12000, 5000],
    ["B", 8000, 3000],
    ["C", 25000, 10000],
    ["D", 3000, 1000],
    ["E", 4500, 1500],
    ["F", 6000, 2000],
    ["G", 9500, 4000],
  ] as const) {
    const product = await testDb.product.create({
      data: { code: key, name: `Producto ${key}`, categoryId: category.id, basePriceCents: price },
    });
    const variant = await testDb.variant.create({
      data: { productId: product.id, sku: key, barcode: `BC-${key}`, avgCostCents: cost },
    });
    await testDb.$transaction((tx) =>
      recordMovement(tx, {
        variantId: variant.id,
        locationId: location.id,
        userId: owner.id,
        type: "INITIAL",
        quantity: 40,
      }),
    );
    variants[key] = variant.id;
  }
  await openCashSession(cashier, { openingFloatCents: 0 }, testDb);

  let seq = 0;
  const sell = (actor: Actor, lines: [string, number][], total: number) =>
    completeSale(
      actor,
      {
        clientRequestId: `request-dash-${(seq += 1)}`,
        lines: lines.map(([key, quantity]) => ({ variantId: variants[key] as string, quantity })),
        payments: [{ method: "CASH", amountCents: total }],
      },
      testDb,
    );
  // Siete ventas: la más vendida es A (6), luego B (4), C (3), D/E (2 y 2), F (1), G (1)
  const first = await sell(cashier, [["A", 3]], 36000);
  await sell(
    cashier,
    [
      ["A", 2],
      ["B", 1],
    ],
    32000,
  );
  await sell(
    manager,
    [
      ["A", 1],
      ["B", 3],
      ["C", 1],
    ],
    61000,
  );
  await sell(
    manager,
    [
      ["C", 2],
      ["D", 2],
    ],
    56000,
  );
  await sell(cashier, [["E", 2]], 9000);
  await sell(
    manager,
    [
      ["F", 1],
      ["G", 1],
    ],
    15500,
  );
  await sell(cashier, [["C", 0 + 1]], 25000);
  // Una devolución de una A de la primera venta
  const line = await testDb.saleItem.findFirstOrThrow({ where: { saleId: first.id } });
  await processReturn(
    cashier,
    {
      clientRequestId: "request-dash-return",
      saleId: first.id,
      items: [{ saleItemId: line.id, quantity: 1, condition: "RESELLABLE" }],
      reason: "Talla incorrecta",
      refundMethod: "STORE_CREDIT",
      customerId: (await testDb.customer.create({ data: { name: "Ana" } })).id,
    },
    testDb,
  );
}, 120_000);

afterAll(async () => {
  await db.$disconnect();
  await closeDatabase();
});

describe("the dashboard of the day", () => {
  it("reconciles every figure with the sales and lines of today", async () => {
    const dashboard = await getDashboard(reportAccess(manager));
    const { summary, hours, top } = dashboard;

    const sales = await testDb.sale.aggregate({
      where: {
        status: "COMPLETED",
        createdAt: { gte: dashboard.range.from, lte: dashboard.range.to },
      },
      _sum: { totalCents: true },
      _count: { _all: true },
    });
    const lines = await testDb.saleItem.aggregate({
      where: {
        sale: {
          status: "COMPLETED",
          createdAt: { gte: dashboard.range.from, lte: dashboard.range.to },
        },
      },
      _sum: { lineTotalCents: true, quantity: true },
    });
    expect(summary.salesCents).toBe(sales._sum.totalCents);
    expect(summary.salesCents).toBe(lines._sum.lineTotalCents);
    expect(summary.tickets).toBe(sales._count._all);
    expect(summary.unitsSold).toBe(lines._sum.quantity);
    expect(summary.averageTicketCents).toBe(
      Math.round((sales._sum.totalCents ?? 0) / sales._count._all),
    );
    expect(summary.returnsCents).toBe(12000);
    expect(summary.netCents).toBe((sales._sum.totalCents ?? 0) - 12000);

    // por hora: todas las horas de atención y la misma suma
    expect(hours.length).toBeGreaterThanOrEqual(13);
    expect(hours[0]?.hour).toBeLessThanOrEqual(8);
    expect(hours.reduce((sum, row) => sum + row.salesCents, 0)).toBe(summary.salesCents);
    expect(hours.reduce((sum, row) => sum + row.tickets, 0)).toBe(summary.tickets);

    // lo más vendido (netas de devolución; en empate, la que más facturó): A 5, C 4, B 4, E 2, D 2
    expect(top.map((row) => [row.name, row.netUnits])).toEqual([
      ["Producto A", 5],
      ["Producto C", 4],
      ["Producto B", 4],
      ["Producto E", 2],
      ["Producto D", 2],
    ]);
  });

  it("gives profit to the manager only", async () => {
    const manager_ = await getDashboard(reportAccess(manager));
    // Ingreso sin ISV y costo de lo vendido y devuelto: cifras de reports.test aplicadas a estos datos
    expect(manager_.summary.financial).not.toBeNull();
    const costSold = 5000 * 6 + 3000 * 4 + 10000 * 4 + 1000 * 2 + 1500 * 2 + 2000 + 4000;
    expect(manager_.summary.financial?.costCents).toBe(costSold - 5000); // la A devuelta vuelve al estante
    const cashier_ = await getDashboard(reportAccess(cashier));
    expect(cashier_.summary.financial).toBeNull();
    expect(JSON.stringify(cashier_)).not.toMatch(/costCents|profitCents|marginBps|revenueCents/);
  });

  it("shows a cashier only their own sales", async () => {
    const mine = await getDashboard(reportAccess(cashier));
    // Las del cajero: 36 000 + 32 000 + 9 000 + 25 000 = 102 000 en 4 tickets, y la devolución que él hizo
    expect(mine.summary).toMatchObject({ tickets: 4, salesCents: 102000, returnsCents: 12000 });
    expect(mine.summary.averageTicketCents).toBe(25500);
    expect(mine.hours.reduce((sum, row) => sum + row.salesCents, 0)).toBe(102000);
    const everyone = await getDashboard(reportAccess(manager));
    expect(mine.summary.salesCents).toBeLessThan(everyone.summary.salesCents);
  });

  it("is empty on a day without sales", async () => {
    const yesterday = await getDashboard(reportAccess(manager), addLocalDays(new Date(), -1));
    expect(yesterday.summary).toMatchObject({ tickets: 0, salesCents: 0, averageTicketCents: 0 });
    expect(yesterday.top).toEqual([]);
    expect(yesterday.hours.every((row) => row.salesCents === 0)).toBe(true);
  });
});
