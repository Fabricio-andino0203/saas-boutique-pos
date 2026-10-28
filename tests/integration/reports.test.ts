import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addLocalDays } from "@/lib/dates";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { approveCashClose, openCashSession, submitCashClose } from "@/modules/cash/service";
import { recordMovement } from "@/modules/inventory/service";
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
import { rangeForPreset } from "@/modules/reports/ranges";
import { processReturn } from "@/modules/returns/service";
import { completeSale, voidSale } from "@/modules/sales/service";

import { closeDatabase, resetDatabase, testDb } from "./helpers/db";

/**
 * Un día de la tienda con cifras conocidas (todas calculadas a mano, ISV 15 % incluido en los precios):
 *   Vestido D  L 115.00, costo L 40.00 (Mujer, Marca Aurora, M Rojo)   Camisa S  L 200.00, costo L 80.00 (Hombre, L Azul)
 *   Gorra H    L 50.00 exenta, costo L 20.00 (Accesorios)
 *   T1 cajero:  2 D, efectivo 23 000        T2 cajero: 1 S, tarjeta 20 000
 *   T3 gerente: 1 D con 10 % + 1 H = 10 350 + 5 000 = 15 350, efectivo 20 000 (vuelto 4 650)
 *   T4 cajero:  1 S, anulada (no cuenta)
 *   Devolución 1 (cajero): 1 D de T1, revendible, a crédito de tienda = 11 500
 *   Devolución 2 (gerente): 1 S de T2, dañada, en efectivo = 20 000
 */

const closeAll = async () => {
  await db.$disconnect();
  await closeDatabase();
};

type Actor = { id: string; role: Role };

const ids: Record<string, string> = {};
let cashier: Actor;
let manager: Actor;
let sale2Id = "";
const today = rangeForPreset("today");

beforeAll(async () => {
  await resetDatabase();
  const make = async (username: string, role: Role): Promise<Actor> => {
    const user = await testDb.user.create({
      data: { name: `Nombre ${username}`, username, passwordHash: "x", role },
    });
    ids[username] = user.id;
    return { id: user.id, role };
  };
  const owner = await make("owner", "OWNER");
  manager = await make("manager", "MANAGER");
  cashier = await make("cashier", "CASHIER");

  const location = await testDb.location.create({
    data: { code: "MAIN", name: "Tienda principal", isDefault: true },
  });
  await testDb.terminal.create({ data: { name: "Caja 1", locationId: location.id } });
  const women = await testDb.category.create({ data: { name: "Mujer", slug: "mujer" } });
  const men = await testDb.category.create({ data: { name: "Hombre", slug: "hombre" } });
  const accessories = await testDb.category.create({
    data: { name: "Accesorios", slug: "accesorios" },
  });
  const brand = await testDb.brand.create({ data: { name: "Marca Aurora" } });
  const sizeM = await testDb.size.create({ data: { name: "M", group: "ropa", sortOrder: 2 } });
  const sizeL = await testDb.size.create({ data: { name: "L", group: "ropa", sortOrder: 3 } });
  const red = await testDb.color.create({ data: { name: "Rojo", hex: "#B42318", sortOrder: 1 } });
  const blue = await testDb.color.create({ data: { name: "Azul", hex: "#2F6DB5", sortOrder: 2 } });

  const variant = async (
    key: string,
    spec: {
      name: string;
      price: number;
      cost: number;
      categoryId: string;
      brandId?: string;
      sizeId?: string;
      colorId?: string;
      exempt?: boolean;
    },
  ) => {
    const product = await testDb.product.create({
      data: {
        code: key,
        name: spec.name,
        categoryId: spec.categoryId,
        brandId: spec.brandId,
        basePriceCents: spec.price,
        taxCategory: spec.exempt ? "EXEMPT" : "STANDARD",
      },
    });
    const created = await testDb.variant.create({
      data: {
        productId: product.id,
        sku: key,
        barcode: `BC-${key}`,
        avgCostCents: spec.cost,
        sizeId: spec.sizeId,
        colorId: spec.colorId,
      },
    });
    await testDb.$transaction((tx) =>
      recordMovement(tx, {
        variantId: created.id,
        locationId: location.id,
        userId: owner.id,
        type: "INITIAL",
        quantity: 50,
      }),
    );
    ids[key] = created.id;
    return created;
  };
  await variant("D", {
    name: "Vestido D",
    price: 11500,
    cost: 4000,
    categoryId: women.id,
    brandId: brand.id,
    sizeId: sizeM.id,
    colorId: red.id,
  });
  await variant("S", {
    name: "Camisa S",
    price: 20000,
    cost: 8000,
    categoryId: men.id,
    sizeId: sizeL.id,
    colorId: blue.id,
  });
  await variant("H", {
    name: "Gorra H",
    price: 5000,
    cost: 2000,
    categoryId: accessories.id,
    exempt: true,
  });
  const ana = await testDb.customer.create({ data: { name: "Ana Pérez", phone: "9999-0000" } });

  await openCashSession(cashier, { openingFloatCents: 50000 }, testDb);
  let seq = 0;
  const sell = async (
    actor: Actor,
    lines: { variantId: string; quantity: number; discount?: { type: "PERCENT"; bps: number } }[],
    payments: { method: "CASH" | "CARD"; amountCents: number }[],
  ) =>
    completeSale(actor, { clientRequestId: `request-rep-${(seq += 1)}`, lines, payments }, testDb);

  const t1 = await sell(
    cashier,
    [{ variantId: ids.D!, quantity: 2 }],
    [{ method: "CASH", amountCents: 23000 }],
  );
  const t2 = await sell(
    cashier,
    [{ variantId: ids.S!, quantity: 1 }],
    [{ method: "CARD", amountCents: 20000 }],
  );
  sale2Id = t2.id;
  await sell(
    manager,
    [
      { variantId: ids.D!, quantity: 1, discount: { type: "PERCENT", bps: 1000 } },
      { variantId: ids.H!, quantity: 1 },
    ],
    [{ method: "CASH", amountCents: 20000 }],
  );
  const t4 = await sell(
    cashier,
    [{ variantId: ids.S!, quantity: 1 }],
    [{ method: "CASH", amountCents: 20000 }],
  );
  await voidSale(manager, t4.id, { reason: "Error de captura" }, testDb);

  const lineOf = async (saleId: string) =>
    (await testDb.saleItem.findFirstOrThrow({ where: { saleId } })).id;
  await processReturn(
    cashier,
    {
      clientRequestId: "request-rep-return-1",
      saleId: t1.id,
      items: [{ saleItemId: await lineOf(t1.id), quantity: 1, condition: "RESELLABLE" }],
      reason: "Talla incorrecta",
      refundMethod: "STORE_CREDIT",
      customerId: ana.id,
    },
    testDb,
  );
  await processReturn(
    manager,
    {
      clientRequestId: "request-rep-return-2",
      saleId: t2.id,
      items: [{ saleItemId: await lineOf(t2.id), quantity: 1, condition: "DAMAGED" }],
      reason: "Defecto de fábrica",
      refundMethod: "CASH",
    },
    testDb,
  );
}, 120_000);

afterAll(closeAll);

describe("sales summary", () => {
  it("adds up sales, returns and the average ticket, leaving the voided sale out", async () => {
    const summary = await getSalesSummary(today, {}, false);
    expect(summary).toMatchObject({
      tickets: 3,
      salesCents: 58350,
      returnsCents: 31500,
      netCents: 26850,
      averageTicketCents: 19450,
      unitsSold: 5,
      unitsReturned: 2,
      financial: null,
    });
  });

  it("gives revenue without ISV, cost and margin only when asked for with the financial permission", async () => {
    const summary = await getSalesSummary(today, {}, true);
    // ingreso: (58 350 − 6 959 de ISV) − (31 500 − 4 109 de ISV devuelto) = 24 000
    // costo: 2×40 + 80 + 40 + 20 = 220,00 vendido − 40,00 que volvió al estante (la dañada es merma) = 180,00
    expect(summary.financial).toEqual({
      revenueCents: 24000,
      costCents: 18000,
      profitCents: 6000,
      marginBps: 2500,
    });
  });

  it("shows a cashier only their own sales and the returns they made", async () => {
    const summary = await getSalesSummary(today, { onlySellerId: cashier.id }, false);
    expect(summary).toMatchObject({
      tickets: 2,
      salesCents: 43000,
      returnsCents: 11500,
      netCents: 31500,
    });
    const other = await getSalesSummary(today, { onlySellerId: manager.id }, false);
    expect(other).toMatchObject({ tickets: 1, salesCents: 15350, returnsCents: 20000 });
  });

  it("is empty for a period without sales", async () => {
    const empty = await getSalesSummary(rangeForPreset("yesterday"), {}, true);
    expect(empty).toMatchObject({
      tickets: 0,
      salesCents: 0,
      returnsCents: 0,
      netCents: 0,
      averageTicketCents: 0,
    });
    expect(empty.financial).toEqual({
      revenueCents: 0,
      costCents: 0,
      profitCents: 0,
      marginBps: 0,
    });
  });
});

describe("sales by cashier, method, hour and period", () => {
  it("groups by cashier", async () => {
    const rows = await getSalesByCashier(today);
    expect(rows.map((r) => [r.sellerName, r.tickets, r.salesCents, r.averageTicketCents])).toEqual([
      ["Nombre cashier", 2, 43000, 21500],
      ["Nombre manager", 1, 15350, 15350],
    ]);
    expect(
      (await getSalesByCashier(today, { onlySellerId: manager.id })).map((r) => r.sellerName),
    ).toEqual(["Nombre manager"]);
  });

  it("groups by payment method with the change taken out of cash, and lists the refunds", async () => {
    const result = await getSalesByMethod(today);
    expect(result.methods.map((m) => [m.method, m.tickets, m.amountCents])).toEqual([
      ["CASH", 2, 38350],
      ["CARD", 1, 20000],
    ]);
    expect(result.refunds).toEqual([
      { method: "CASH", amountCents: 20000 },
      { method: "STORE_CREDIT", amountCents: 11500 },
    ]);
  });

  it("groups by hour in Honduras time", async () => {
    const hours = await getSalesByHour(today);
    expect(hours.reduce((sum, row) => sum + row.tickets, 0)).toBe(3);
    expect(hours.reduce((sum, row) => sum + row.salesCents, 0)).toBe(58350);
    const expectedHour = Number(
      new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit",
        hour12: false,
        timeZone: "America/Tegucigalpa",
      }).format(new Date()),
    );
    // Todas las ventas de la prueba son de hace unos minutos: caen en la misma hora (o en la anterior si cruzó una hora)
    expect(hours.every((row) => Math.abs(row.hour - expectedHour) <= 1)).toBe(true);
  });

  it("groups by day and by month, with the returns of the day they happened", async () => {
    const days = await getSalesByPeriod(today, "day");
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({
      tickets: 3,
      salesCents: 58350,
      returnsCents: 31500,
      netCents: 26850,
    });

    // Si una venta se hizo el mes pasado, cae en su mes
    const lastMonth = addLocalDays(new Date(), -40);
    await testDb.sale.update({ where: { id: sale2Id }, data: { createdAt: lastMonth } });
    const wide = { ...rangeForPreset("year"), from: addLocalDays(new Date(), -60) };
    const months = await getSalesByPeriod(wide, "month");
    expect(months.reduce((sum, row) => sum + row.salesCents, 0)).toBe(58350);
    expect(months.length).toBeGreaterThanOrEqual(1);
    const [early] = months;
    expect(early?.salesCents).toBe(20000);
    expect(early?.tickets).toBe(1);
    await testDb.sale.update({ where: { id: sale2Id }, data: { createdAt: new Date() } });
  });
});

describe("sales by category and brand", () => {
  it("nets the returns and, with costs, gives the profit of each category", async () => {
    const rows = await getSalesByDimension(today, "category", {}, true);
    const by = Object.fromEntries(rows.map((row) => [row.name, row]));
    expect(by.Mujer).toMatchObject({
      units: 2,
      soldCents: 33350,
      returnedCents: 11500,
      netCents: 21850,
    });
    // ingreso: (33 350 − 4 350) − (11 500 − 1 500) = 19 000; costo: 3×40 − 40 = 80; utilidad 110
    expect(by.Mujer?.financial).toEqual({
      revenueCents: 19000,
      costCents: 8000,
      profitCents: 11000,
      marginBps: 5789,
    });
    expect(by.Hombre).toMatchObject({
      units: 0,
      soldCents: 20000,
      returnedCents: 20000,
      netCents: 0,
    });
    expect(by.Accesorios).toMatchObject({
      units: 1,
      soldCents: 5000,
      returnedCents: 0,
      netCents: 5000,
    });
    expect(rows.map((row) => row.name)).toEqual(["Mujer", "Accesorios", "Hombre"]);
  });

  it("groups by brand, with a row for what has none", async () => {
    const rows = await getSalesByDimension(today, "brand", {}, false);
    const by = Object.fromEntries(rows.map((row) => [row.name || "sin marca", row]));
    expect(by["Marca Aurora"]).toMatchObject({ units: 2, netCents: 21850 });
    expect(by["sin marca"]).toMatchObject({
      soldCents: 25000,
      returnedCents: 20000,
      netCents: 5000,
    });
    expect(rows.every((row) => row.financial === null)).toBe(true);
  });

  it("limits a cashier to their own sales", async () => {
    const rows = await getSalesByDimension(today, "category", { onlySellerId: cashier.id });
    const by = Object.fromEntries(rows.map((row) => [row.name, row]));
    expect(by.Mujer).toMatchObject({ soldCents: 23000, returnedCents: 11500 });
    expect(by.Accesorios).toBeUndefined();
  });
});

describe("products, rotation and the size × color matrix", () => {
  it("ranks the best sellers net of returns and measures rotation against today's stock", async () => {
    const rows = await listProductSales(today, 1);
    const best = rankProducts(rows, "best", 5);
    expect(best.map((row) => [row.name, row.netUnits, row.soldCents])).toEqual([
      ["Vestido D", 2, 33350],
      ["Gorra H", 1, 5000],
    ]);
    const dress = rows.find((row) => row.name === "Vestido D");
    // 50 al inicio − 3 vendidas + 1 devuelta revendible = 48 en estante
    expect(dress).toMatchObject({ unitsSold: 3, unitsReturned: 1, onHand: 48, rotation: 0.04 });
    expect(dress?.daysOfStock).toBe(24);
    const worst = rankProducts(rows, "worst", 2);
    expect(worst[0]?.name).toBe("Camisa S");
  });

  it("builds the size × color matrix of what was sold", async () => {
    const matrix = await getSizeColorMatrix(today);
    expect(matrix.sizes.map((s) => s.name)).toEqual(["M", "L"]);
    expect(matrix.colors.map((c) => c.name)).toEqual(["Rojo", "Azul"]);
    expect(matrix.totalUnits).toBe(4);
    const cell = (size: string, color: string) =>
      matrix.cells.find(
        (c) =>
          c.sizeId === matrix.sizes.find((s) => s.name === size)?.id &&
          c.colorId === matrix.colors.find((k) => k.name === color)?.id,
      )?.units;
    expect(cell("M", "Rojo")).toBe(3);
    expect(cell("L", "Azul")).toBe(1);
    const women = await testDb.category.findFirstOrThrow({ where: { slug: "mujer" } });
    expect((await getSizeColorMatrix(today, {}, women.id)).totalUnits).toBe(3);
  });
});

describe("inventory reports and cash closings", () => {
  it("values the stock by category at cost and at retail price", async () => {
    const valuation = await getInventoryValuation();
    const by = Object.fromEntries(valuation.rows.map((row) => [row.categoryName, row]));
    // D: 48 en estante; S: 50 − 1 − 1 + 1 (anulación) + 1 (devuelta) − 1 (merma) = 49; H: 49
    expect(by.Mujer).toMatchObject({ units: 48, costValueCents: 192000, retailValueCents: 552000 });
    expect(by.Hombre).toMatchObject({
      units: 49,
      costValueCents: 392000,
      retailValueCents: 980000,
    });
    expect(by.Accesorios).toMatchObject({
      units: 49,
      costValueCents: 98000,
      retailValueCents: 245000,
    });
    expect(valuation.units).toBe(146);
    expect(valuation.costValueCents).toBe(682000);
    expect(valuation.retailValueCents).toBe(1777000);
  });

  it("finds garments that have not sold for a while, or ever, with the cost they tie up", async () => {
    const location = await testDb.location.findFirstOrThrow();
    const category = await testDb.category.findFirstOrThrow({ where: { slug: "mujer" } });
    const owner = ids.owner as string;
    const make = async (code: string, stock: number) => {
      const product = await testDb.product.create({
        data: { code, name: `Producto ${code}`, categoryId: category.id, basePriceCents: 10000 },
      });
      const created = await testDb.variant.create({
        data: { productId: product.id, sku: code, barcode: `BC-${code}`, avgCostCents: 3000 },
      });
      await testDb.$transaction((tx) =>
        recordMovement(tx, {
          variantId: created.id,
          locationId: location.id,
          userId: owner,
          type: "INITIAL",
          quantity: stock,
        }),
      );
      return created;
    };
    await make("DEAD", 5); // nunca se vendió
    const old = await make("OLD", 2);
    const sale = await completeSale(
      cashier,
      {
        clientRequestId: "request-rep-old",
        lines: [{ variantId: old.id, quantity: 1 }],
        payments: [{ method: "CARD", amountCents: 10000 }],
      },
      testDb,
    );
    await testDb.sale.update({
      where: { id: sale.id },
      data: { createdAt: addLocalDays(new Date(), -100) },
    });

    const dead = await getDeadStock(90);
    expect(dead.rows.map((row) => [row.sku, row.onHand, row.costValueCents])).toEqual([
      ["DEAD", 5, 15000],
      ["OLD", 1, 3000],
    ]);
    expect(dead.rows[0]?.lastSaleAt).toBeNull();
    expect(dead.rows[1]?.lastSaleAt).toBeInstanceOf(Date);
    expect(dead.totalCostValueCents).toBe(18000);
    // Con un plazo más corto, "OLD" sigue; con uno más largo (200 días) ya no
    expect((await getDeadStock(200)).rows.map((row) => row.sku)).toEqual(["DEAD"]);
  });

  it("lists the closed shifts with their differences", async () => {
    // Fondo 500,00 + efectivo 230,00 + 200,00 − vuelto 46,50 − reembolso en efectivo 200,00 = 683,50
    await submitCashClose(cashier, { countedCashCents: 68000, notes: "Faltaron L 3.50" }, testDb);
    const closings = await getCashClosings(today);
    expect(closings).toMatchObject({ count: 1, withDifference: 1, shortCents: 350, overCents: 0 });
    expect(closings.rows[0]).toMatchObject({
      expectedCents: 68350,
      countedCents: 68000,
      differenceCents: -350,
      userName: "Nombre cashier",
      status: "CLOSED_PENDING_APPROVAL",
    });
    await approveCashClose(manager, closings.rows[0]!.id, testDb);
    expect((await getCashClosings(today)).rows[0]?.status).toBe("CLOSED");
    expect((await getCashClosings(rangeForPreset("yesterday"))).count).toBe(0);
  });
});
