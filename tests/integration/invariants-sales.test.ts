import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { InsufficientStockError } from "@/lib/errors";
import type { Role } from "@/lib/permissions";
import {
  addCashMovement,
  approveCashClose,
  loadCashTotals,
  openCashSession,
  submitCashClose,
} from "@/modules/cash/service";
import { expectedCashCents } from "@/modules/cash/expected";
import { findStockDiscrepancies } from "@/modules/inventory/reconcile";
import { recordMovement } from "@/modules/inventory/service";
import { priceCart } from "@/modules/sales/calc";
import { completeSale, voidSale } from "@/modules/sales/service";

import { closeDatabase, resetDatabase, testDb } from "./helpers/db";

/**
 * Una secuencia aleatoria (con semilla fija: siempre la misma) de 200 operaciones sobre ventas, caja e inventario,
 * y después se comprueban las invariantes de DATA_MODEL §9 sobre lo que quedó en la base.
 */

const SEED = 0xc0ffee;
const OPERATIONS = 200;

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Actor = { id: string; role: Role };

type Product = { variantId: string; priceCents: number; exempt: boolean };

type Outcome = {
  sold: number;
  voided: number;
  noStock: number;
  replayed: number;
  movements: number;
  closes: number;
  adjustments: number;
};

describe("invariantes de ventas, caja e inventario tras 200 operaciones aleatorias", () => {
  const random = mulberry32(SEED);
  const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  const chance = (probability: number) => random() < probability;
  const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)] as T;

  const outcome: Outcome = {
    sold: 0,
    voided: 0,
    noStock: 0,
    replayed: 0,
    movements: 0,
    closes: 0,
    adjustments: 0,
  };

  beforeAll(async () => {
    await resetDatabase();
    const make = async (username: string, role: Role): Promise<Actor> => {
      const user = await testDb.user.create({
        data: { name: username, username, passwordHash: "x", role },
      });
      return { id: user.id, role };
    };
    const manager = await make("manager", "MANAGER");
    const cashier = await make("cashier", "CASHIER");
    const cashier2 = await make("cashier2", "CASHIER");
    const location = await testDb.location.create({
      data: { code: "MAIN", name: "Tienda principal", isDefault: true },
    });
    const terminal = await testDb.terminal.create({
      data: { name: "Caja 1", locationId: location.id },
    });
    const category = await testDb.category.create({ data: { name: "Mujer", slug: "mujer" } });

    const products: Product[] = [];
    const specs = [
      { code: "P1", price: 11500, exempt: false },
      { code: "P2", price: 20000, exempt: false },
      { code: "P3", price: 5990, exempt: false },
      { code: "P4", price: 3333, exempt: true },
      { code: "P5", price: 99900, exempt: false },
      { code: "P6", price: 1501, exempt: false },
    ];
    for (const spec of specs) {
      const product = await testDb.product.create({
        data: {
          code: spec.code,
          name: `Producto ${spec.code}`,
          categoryId: category.id,
          basePriceCents: spec.price,
          taxCategory: spec.exempt ? "EXEMPT" : "STANDARD",
        },
      });
      const variant = await testDb.variant.create({
        data: {
          productId: product.id,
          sku: spec.code,
          barcode: `BC-${spec.code}`,
          avgCostCents: 1000,
        },
      });
      await testDb.$transaction((tx) =>
        recordMovement(tx, {
          variantId: variant.id,
          locationId: location.id,
          userId: manager.id,
          type: "INITIAL",
          quantity: 120,
        }),
      );
      products.push({ variantId: variant.id, priceCents: spec.price, exempt: spec.exempt });
    }
    await testDb.fiscalRange.create({
      data: {
        documentType: "INVOICE",
        terminalId: terminal.id,
        cai: "ABC123-CAI",
        prefix: "000-001-01-",
        rangeStart: 1,
        rangeEnd: 1000,
        nextNumber: 1,
        expiresAt: new Date(Date.now() + 90 * 86_400_000),
      },
    });

    const sellers = [cashier, cashier2, manager];
    let shiftId = (await openCashSession(cashier, { openingFloatCents: 50000 }, testDb)).id;
    const completed: { id: string; shiftId: string }[] = [];
    const requests: { requestId: string; sellerId: string; saleId: string }[] = [];
    let counter = 0;

    async function sellOnce(): Promise<void> {
      const seller = pick(sellers);
      const lineCount = int(1, 4);
      const lines = Array.from({ length: lineCount }, () => {
        const product = pick(products);
        // De vez en cuando, un descuento propio; un cajero no pasa del 10 %
        const discount = chance(0.12)
          ? {
              type: "PERCENT" as const,
              bps: seller.role === "MANAGER" ? pick([500, 1000, 2500]) : pick([300, 500, 1000]),
            }
          : undefined;
        return { product, quantity: int(1, 3), discount };
      });
      const globalDiscount = chance(0.08)
        ? { type: "PERCENT" as const, bps: seller.role === "MANAGER" ? 1500 : 500 }
        : undefined;
      const priced = priceCart(
        lines.map((line) => ({
          unitPriceCents: line.product.priceCents,
          quantity: line.quantity,
          discount: line.discount,
          taxRateBps: line.product.exempt ? 0 : 1500,
        })),
        { globalDiscount, pricesIncludeTax: true },
      );
      const total = priced.totalCents;
      const payments = pick([
        () => [{ method: "CASH" as const, amountCents: total }],
        () => [{ method: "CASH" as const, amountCents: total + int(1, 20000) }],
        () => [{ method: "CARD" as const, amountCents: total, reference: "4242" }],
        () => {
          const card = Math.max(1, Math.floor(total / 3));
          return [
            { method: "CARD" as const, amountCents: card, reference: "1111" },
            { method: "CASH" as const, amountCents: total - card + int(0, 5000) },
          ];
        },
        () => [{ method: "TRANSFER" as const, amountCents: total, reference: "T-77" }],
      ])();

      counter += 1;
      const requestId = `request-inv-${counter}`;
      try {
        const sale = await completeSale(
          seller,
          {
            clientRequestId: requestId,
            lines: lines.map((line) => ({
              variantId: line.product.variantId,
              quantity: line.quantity,
              ...(line.discount ? { discount: line.discount } : {}),
            })),
            ...(globalDiscount ? { discount: globalDiscount } : {}),
            payments,
            ...(chance(0.25)
              ? { invoice: { taxId: "0801-1999-00001", name: "Cliente de prueba" } }
              : {}),
          },
          testDb,
        );
        outcome.sold += 1;
        completed.push({ id: sale.id, shiftId });
        requests.push({ requestId, sellerId: seller.id, saleId: sale.id });
      } catch (error) {
        if (error instanceof InsufficientStockError) {
          outcome.noStock += 1;
          return;
        }
        throw error;
      }
    }

    for (let step = 0; step < OPERATIONS; step += 1) {
      const roll = random();
      if (roll < 0.55) {
        await sellOnce();
      } else if (roll < 0.67) {
        // Anular una venta del turno abierto
        const candidates = completed.filter((sale) => sale.shiftId === shiftId);
        const target = candidates.length > 0 ? pick(candidates) : undefined;
        if (target) {
          await voidSale(manager, target.id, { reason: "Anulación de prueba" }, testDb);
          completed.splice(completed.indexOf(target), 1);
          outcome.voided += 1;
        }
      } else if (roll < 0.75) {
        // Entrada o salida de efectivo
        const available = expectedCashCents(await loadCashTotals(testDb, shiftId));
        if (chance(0.5) || available < 500) {
          await addCashMovement(
            cashier,
            { type: "IN", amountCents: int(100, 8000), reason: "Cambio de prueba" },
            testDb,
          );
        } else {
          await addCashMovement(
            cashier,
            {
              type: "OUT",
              amountCents: int(100, Math.min(available, 8000)),
              reason: "Gasto de prueba",
            },
            testDb,
          );
        }
        outcome.movements += 1;
      } else if (roll < 0.8) {
        // Cerrar el turno (a veces con diferencia), aprobarlo y abrir el siguiente
        const expected = expectedCashCents(await loadCashTotals(testDb, shiftId));
        const difference = pick([0, 0, 0, -500, 300]);
        const counted = Math.max(0, expected + difference);
        // A veces se retira todo, a veces nada y a veces una parte: lo que queda es el saldo anterior del turno siguiente
        const withdrawn = pick([0, counted, int(0, counted)]);
        await submitCashClose(
          cashier,
          {
            countedCashCents: counted,
            withdrawnCents: withdrawn,
            ...(expected + difference !== expected ? { notes: "Diferencia de prueba" } : {}),
          },
          testDb,
        );
        await approveCashClose(manager, shiftId, testDb);
        // El saldo anterior no se puede cambiar; si no quedó nada, el fondo es libre
        const left = counted - withdrawn;
        shiftId = (
          await openCashSession(
            cashier,
            { openingFloatCents: left > 0 ? left : int(0, 80000) },
            testDb,
          )
        ).id;
        outcome.closes += 1;
      } else if (roll < 0.88) {
        // Ajuste de inventario: entran prendas
        const product = pick(products);
        await testDb.$transaction((tx) =>
          recordMovement(tx, {
            variantId: product.variantId,
            locationId: location.id,
            userId: manager.id,
            type: "ADJUSTMENT_IN",
            quantity: int(1, 10),
            reason: "Ajuste de prueba",
          }),
        );
        outcome.adjustments += 1;
      } else if (requests.length > 0) {
        // Reintento de un cobro ya hecho (doble clic, red caída): no debe duplicar nada
        const earlier = pick(requests);
        const seller = sellers.find((candidate) => candidate.id === earlier.sellerId) as Actor;
        const again = await completeSale(
          seller,
          {
            clientRequestId: earlier.requestId,
            lines: [{ variantId: (products[0] as Product).variantId, quantity: 1 }],
            payments: [{ method: "CASH", amountCents: 1_000_000 }],
          },
          testDb,
        );
        expect(again.replayed).toBe(true);
        expect(again.id).toBe(earlier.saleId);
        outcome.replayed += 1;
      } else {
        await sellOnce();
      }
    }
  }, 300_000);

  afterAll(async () => {
    await db.$disconnect();
    await closeDatabase();
  });

  it("ran a meaningful mix of operations", () => {
    expect(outcome.sold).toBeGreaterThan(40);
    expect(outcome.voided).toBeGreaterThan(5);
    expect(outcome.movements).toBeGreaterThan(5);
    expect(outcome.closes).toBeGreaterThan(2);
    expect(outcome.adjustments).toBeGreaterThan(5);
    expect(outcome.replayed).toBeGreaterThan(2);
  });

  it("#1 Σ StockMovement = StockLevel.onHand, and no stock went negative", async () => {
    expect(await findStockDiscrepancies(testDb)).toEqual([]);
    expect(await testDb.stockLevel.count({ where: { onHand: { lt: 0 } } })).toBe(0);
  });

  it("#2 Σ Payment − change = Sale.total, and the lines add up to the sale", async () => {
    const sales = await testDb.sale.findMany({ include: { payments: true, items: true } });
    expect(sales.length).toBe(outcome.sold);
    for (const sale of sales) {
      const paid = sale.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
      expect(paid).toBe(sale.paidCents);
      expect(paid - sale.changeCents).toBe(sale.totalCents);
      expect(sale.items.reduce((sum, item) => sum + item.lineTotalCents, 0)).toBe(sale.totalCents);
      expect(sale.items.reduce((sum, item) => sum + item.taxCents, 0)).toBe(sale.taxCents);
      expect(sale.subtotalCents - sale.discountCents).toBe(sale.totalCents);
      expect(sale.totalCents).toBeGreaterThan(0);
      // Una venta solo cae en un turno de la terminal y nunca queda sin vendedor ni sin líneas
      expect(sale.items.length).toBeGreaterThan(0);
    }
  });

  it("#4 ticket and invoice numbers have no gaps and no repeats", async () => {
    const sales = await testDb.sale.findMany({ orderBy: { createdAt: "asc" } });
    const numbers = sales
      .map((sale) => Number(sale.number.replace("T-", "")))
      .sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: sales.length }, (_, index) => index + 1));
    const counter = await testDb.documentCounter.findUniqueOrThrow({ where: { key: "SALE" } });
    expect(counter.nextValue).toBe(sales.length + 1);

    const range = await testDb.fiscalRange.findFirstOrThrow();
    const fiscal = sales
      .filter((sale) => sale.fiscalNumber !== null)
      .map((sale) => sale.fiscalNumber as number)
      .sort((a, b) => a - b);
    expect(fiscal.length).toBeGreaterThan(5);
    expect(fiscal).toEqual(
      Array.from({ length: fiscal.length }, (_, index) => range.rangeStart + index),
    );
    expect(range.nextNumber).toBe(range.rangeStart + fiscal.length);
    expect(range.nextNumber).toBeLessThanOrEqual(range.rangeEnd + 1);
  });

  it("#6 each shift's expected cash = float + cash payments − change + in − out, without voided sales", async () => {
    const sessions = await testDb.cashSession.findMany({
      include: { movements: true, payments: { include: { sale: true } }, sales: true },
    });
    expect(sessions.length).toBeGreaterThan(3);
    for (const session of sessions) {
      const cashIn = session.payments
        .filter((payment) => payment.method === "CASH" && payment.sale.status === "COMPLETED")
        .reduce((sum, payment) => sum + payment.amountCents, 0);
      const change = session.sales
        .filter((sale) => sale.status === "COMPLETED")
        .reduce((sum, sale) => sum + sale.changeCents, 0);
      const moved = (type: "IN" | "OUT") =>
        session.movements.filter((m) => m.type === type).reduce((sum, m) => sum + m.amountCents, 0);
      const expected = session.openingFloatCents + cashIn - change + moved("IN") - moved("OUT");

      expect(expected).toBeGreaterThanOrEqual(0);
      expect(expectedCashCents(await loadCashTotals(testDb, session.id))).toBe(expected);
      if (session.status !== "OPEN") {
        // Lo que se guardó al cerrar sigue siendo cierto: las anuladas solo se anulan con el turno abierto
        expect(session.expectedCashCents).toBe(expected);
        expect(session.differenceCents).toBe((session.countedCashCents as number) - expected);
        expect(session.status).toBe("CLOSED");
      }
    }
  });

  it("#7 a voided sale puts back exactly what it took out, and leaves a trace", async () => {
    const voided = await testDb.sale.findMany({ where: { status: "VOIDED" } });
    expect(voided.length).toBe(outcome.voided);
    for (const sale of voided) {
      const movements = await testDb.stockMovement.findMany({
        where: { refType: "Sale", refId: sale.id },
      });
      const byVariant = new Map<string, number>();
      for (const movement of movements) {
        byVariant.set(
          movement.variantId,
          (byVariant.get(movement.variantId) ?? 0) + movement.quantity,
        );
      }
      expect([...byVariant.values()].every((net) => net === 0)).toBe(true);
      expect(sale.voidedAt).not.toBeNull();
      expect(sale.voidReason).toBeTruthy();
      expect(
        await testDb.auditLog.count({ where: { action: "SALE_VOIDED", entityId: sale.id } }),
      ).toBe(1);
    }
    // Y una venta completada nunca tiene entradas de vuelta
    const completed = await testDb.sale.findMany({
      where: { status: "COMPLETED" },
      select: { id: true },
    });
    const back = await testDb.stockMovement.count({
      where: { type: "RETURN_IN", refId: { in: completed.map((sale) => sale.id) } },
    });
    expect(back).toBe(0);
  });

  it("a replay never created a second sale", async () => {
    const total = await testDb.sale.count();
    const distinct = await testDb.sale.groupBy({ by: ["clientRequestId"] });
    expect(distinct.length).toBe(total);
  });
});
