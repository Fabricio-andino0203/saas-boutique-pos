import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { InsufficientStockError } from "@/lib/errors";
import type { Role } from "@/lib/permissions";
import { expectedCashCents } from "@/modules/cash/expected";
import { loadCashTotals, openCashSession } from "@/modules/cash/service";
import { recordMovement } from "@/modules/inventory/service";
import { verifyBooks } from "@/modules/ops/verify-books";
import { completeSale, type CompletedSale } from "@/modules/sales/service";

import { closeDatabase, resetDatabase, testDb } from "./helpers/db";

/**
 * Criterio de la Fase 6: 50 cobros a la vez, sin ventas duplicadas ni descuadres. Se lanzan los 50 en el mismo instante,
 * mezclando lo que más se complica en un mostrador ocupado: reintentos del mismo botón (mismo `clientRequestId`), tres
 * personas peleando por las últimas prendas, líneas en distinto orden (para provocar bloqueos cruzados) y pagos mixtos.
 * Al final los libros tienen que cuadrar exactamente, comprobados con la misma revisión que se usa tras restaurar un respaldo.
 */

type Actor = { id: string; role: Role };

const PRICE_A = 11500;
const PRICE_B = 20000;
const PRICE_C = 5000;
const STOCK_A = 30;
const STOCK_B = 3;
const STOCK_C = 100;

let cashiers: Actor[];
let variants: { a: string; b: string; c: string };
let shiftId: string;
let openingFloatCents: number;
let calls: PromiseSettledResult<CompletedSale>[];
let elapsedMs = 0;

const cash = (amountCents: number) => ({ method: "CASH" as const, amountCents });
const card = (amountCents: number) => ({
  method: "CARD" as const,
  amountCents,
  reference: "AUT-1",
});

function sell(
  actor: Actor,
  id: string,
  lines: { variantId: string; quantity: number }[],
  payments: object[],
) {
  return completeSale(actor, { clientRequestId: id, lines, payments }, testDb);
}

beforeAll(async () => {
  await resetDatabase();
  const make = async (username: string, role: Role): Promise<Actor> => {
    const user = await testDb.user.create({
      data: { name: username, username, passwordHash: "x", role },
    });
    return { id: user.id, role };
  };
  const owner = await make("owner", "OWNER");
  cashiers = [await make("caja-a", "CASHIER"), await make("caja-b", "CASHIER")];

  const location = await testDb.location.create({
    data: { code: "MAIN", name: "Tienda principal", isDefault: true },
  });
  await testDb.terminal.create({ data: { name: "Caja 1", locationId: location.id } });
  const category = await testDb.category.create({ data: { name: "Mujer", slug: "mujer" } });

  const variant = async (code: string, price: number, stock: number) => {
    const product = await testDb.product.create({
      data: { code, name: `Producto ${code}`, categoryId: category.id, basePriceCents: price },
    });
    const created = await testDb.variant.create({
      data: { productId: product.id, sku: code, barcode: `BC-${code}`, avgCostCents: 2000 },
    });
    await testDb.$transaction((tx) =>
      recordMovement(tx, {
        variantId: created.id,
        locationId: location.id,
        userId: owner.id,
        type: "INITIAL",
        quantity: stock,
      }),
    );
    return created.id;
  };
  variants = {
    a: await variant("PRD-A", PRICE_A, STOCK_A),
    b: await variant("PRD-B", PRICE_B, STOCK_B),
    c: await variant("PRD-C", PRICE_C, STOCK_C),
  };
  openingFloatCents = 50_000;
  const shift = await openCashSession(cashiers[0] as Actor, { openingFloatCents }, testDb);
  shiftId = shift.id;

  // Los 50 intentos, todos juntos.
  const attempts: Promise<CompletedSale>[] = [];
  const who = (index: number) => cashiers[index % 2] as Actor;

  // 30 ventas distintas de una A y una C, con las líneas en un orden u otro; la mitad paga con tarjeta y efectivo.
  for (let i = 0; i < 30; i += 1) {
    const lines =
      i % 2 === 0
        ? [
            { variantId: variants.a, quantity: 1 },
            { variantId: variants.c, quantity: 1 },
          ]
        : [
            { variantId: variants.c, quantity: 1 },
            { variantId: variants.a, quantity: 1 },
          ];
    const total = PRICE_A + PRICE_C;
    const payments = i % 3 === 0 ? [cash(5000), card(total - 5000)] : [cash(total + 500)];
    attempts.push(sell(who(i), `conc-a-${i}`, lines, payments));
  }
  // 10 cobros por las 3 únicas prendas B: tres pueden, siete no.
  for (let i = 0; i < 10; i += 1) {
    attempts.push(
      sell(who(i), `conc-b-${i}`, [{ variantId: variants.b, quantity: 1 }], [cash(PRICE_B)]),
    );
  }
  // 5 ventas de una C, cada una enviada dos veces (el botón apretado dos veces).
  for (let i = 0; i < 5; i += 1) {
    for (let copy = 0; copy < 2; copy += 1) {
      attempts.push(
        sell(who(i), `conc-dup-${i}`, [{ variantId: variants.c, quantity: 1 }], [cash(PRICE_C)]),
      );
    }
  }
  expect(attempts).toHaveLength(50);

  const started = performance.now();
  calls = await Promise.allSettled(attempts);
  elapsedMs = Math.round(performance.now() - started);
}, 120_000);

afterAll(async () => {
  console.info(
    `50 cobros simultáneos: ${elapsedMs} ms en total (${Math.round(elapsedMs / 50)} ms por cobro)`,
  );
  await db.$disconnect();
  await closeDatabase();
});

describe("50 simultaneous sales", () => {
  it("finish in a reasonable time", () => {
    expect(elapsedMs).toBeLessThan(30_000);
  });

  it("fail only for the garments that ran out, and say so", () => {
    const failures = calls.filter(
      (call): call is PromiseRejectedResult => call.status === "rejected",
    );
    expect(failures).toHaveLength(10 - STOCK_B);
    for (const failure of failures) {
      expect(failure.reason).toBeInstanceOf(InsufficientStockError);
    }
  });

  it("create exactly the sales that were possible, with no duplicates", async () => {
    const created = 30 + STOCK_B + 5;
    expect(await testDb.sale.count()).toBe(created);
    // Cada reintento del mismo botón devolvió la misma venta, y solo uno de los dos la creó
    for (let i = 0; i < 5; i += 1) {
      const pair = calls.slice(40 + i * 2, 42 + i * 2) as PromiseFulfilledResult<CompletedSale>[];
      expect(pair[0]?.value.id).toBe(pair[1]?.value.id);
      expect(pair.filter((call) => !call.value.replayed)).toHaveLength(1);
    }
    expect(
      await testDb.sale.count({ where: { clientRequestId: { startsWith: "conc-dup-" } } }),
    ).toBe(5);
    expect(await testDb.payment.count()).toBeGreaterThanOrEqual(created);
  });

  it("number the tickets one after another with no gaps or repeats", async () => {
    const sales = await testDb.sale.findMany({
      select: { number: true },
      orderBy: { number: "asc" },
    });
    expect(sales.map((sale) => sale.number)).toEqual(
      Array.from({ length: sales.length }, (_, index) => `T-${String(index + 1).padStart(6, "0")}`),
    );
    const counter = await testDb.documentCounter.findUniqueOrThrow({ where: { key: "SALE" } });
    expect(counter.nextValue).toBe(sales.length + 1);
  });

  it("leave the stock exactly where the sales say, never below zero", async () => {
    const onHand = async (variantId: string) =>
      (await testDb.stockLevel.findFirstOrThrow({ where: { variantId } })).onHand;
    expect(await onHand(variants.a)).toBe(0);
    expect(await onHand(variants.b)).toBe(0);
    expect(await onHand(variants.c)).toBe(STOCK_C - 30 - 5);
    expect(await testDb.stockLevel.count({ where: { onHand: { lt: 0 } } })).toBe(0);
  });

  it("leave the cash drawer with exactly what the payments say", async () => {
    const [cashSum] = await testDb.$queryRaw<{ cash: number; change: number }[]>`
      SELECT COALESCE(SUM(p."amountCents") FILTER (WHERE p."method" = 'CASH'), 0)::int AS "cash",
             (SELECT COALESCE(SUM("changeCents"), 0)::int FROM "Sale" WHERE "cashSessionId" = ${shiftId}) AS "change"
      FROM "Payment" p
      WHERE p."cashSessionId" = ${shiftId}
    `;
    const expected = expectedCashCents(await loadCashTotals(testDb, shiftId));
    expect(expected).toBe(openingFloatCents + (cashSum?.cash ?? 0) - (cashSum?.change ?? 0));
  });

  it("leave every book balanced", async () => {
    const report = await verifyBooks(testDb);
    expect(report.problems).toEqual([]);
    expect(report.summary.sales).toBe(30 + STOCK_B + 5);
  });
});
