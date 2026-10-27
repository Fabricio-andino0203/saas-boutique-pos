import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addLocalDays } from "@/lib/dates";
import { db } from "@/lib/db";
import {
  InsufficientCashError,
  InsufficientCreditError,
  InsufficientStockError,
  LayawayStateError,
} from "@/lib/errors";
import { percentOf } from "@/lib/money";
import type { Role } from "@/lib/permissions";
import { expectedCashCents } from "@/modules/cash/expected";
import {
  addCashMovement,
  approveCashClose,
  loadCashTotals,
  openCashSession,
  submitCashClose,
} from "@/modules/cash/service";
import { findCreditDiscrepancies } from "@/modules/credit/reconcile";
import { adjustStoreCredit } from "@/modules/customers/credit";
import { findReservedDiscrepancies, findStockDiscrepancies } from "@/modules/inventory/reconcile";
import { recordMovement } from "@/modules/inventory/service";
import {
  addLayawayPayment,
  cancelLayaway,
  createLayaway,
  expireOverdueLayaways,
  settleLayaway,
} from "@/modules/layaways/service";
import { valueOfUnits } from "@/modules/returns/calc";
import { findOverReturns } from "@/modules/returns/reconcile";
import { processExchange, processReturn } from "@/modules/returns/service";
import { priceCart } from "@/modules/sales/calc";
import { completeSale, voidSale } from "@/modules/sales/service";

import { closeDatabase, resetDatabase, testDb } from "./helpers/db";

/**
 * Una secuencia aleatoria (con semilla fija: siempre la misma) de 200 operaciones que mezcla todo lo de la Fase 4 con lo
 * de la Fase 3: ventas (también con crédito de tienda y factura), devoluciones, cambios, notas de crédito, apartados
 * (crear, abonar, saldar, cancelar, vencer), ajustes de crédito, anulaciones, caja e inventario. Al final se comprueban las
 * invariantes de DATA_MODEL §9 sobre lo que quedó en la base.
 */

const SEED = 0xfa5e4;
const OPERATIONS = 200;
const DAY = 86_400_000;

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

const outcome = {
  sold: 0,
  creditSales: 0,
  returns: 0,
  cashRefunds: 0,
  exchanges: 0,
  layawaysCreated: 0,
  layawayPayments: 0,
  layawaysSettled: 0,
  layawaysCancelled: 0,
  layawaysExpired: 0,
  adjustments: 0,
  voided: 0,
  movements: 0,
  closes: 0,
  stockAdjustments: 0,
  replays: 0,
  skipped: 0,
};

describe("invariantes de la Fase 4 tras 200 operaciones aleatorias", () => {
  const random = mulberry32(SEED);
  const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  const chance = (probability: number) => random() < probability;
  const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)] as T;

  let invoiceRangeId = "";
  let noteRangeId = "";

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
    const sellers = [cashier, cashier2, manager];

    const location = await testDb.location.create({
      data: { code: "MAIN", name: "Tienda principal", isDefault: true },
    });
    const terminal = await testDb.terminal.create({
      data: { name: "Caja 1", locationId: location.id },
    });
    const category = await testDb.category.create({ data: { name: "Mujer", slug: "mujer" } });
    const customers: { id: string }[] = [];
    for (let index = 1; index <= 8; index += 1) {
      customers.push(
        await testDb.customer.create({
          data: { name: `Cliente ${index}`, phone: `7000-000${index}` },
        }),
      );
    }

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
          quantity: 150,
        }),
      );
      products.push({ variantId: variant.id, priceCents: spec.price, exempt: spec.exempt });
    }
    const expiresAt = new Date(Date.now() + 90 * DAY);
    invoiceRangeId = (
      await testDb.fiscalRange.create({
        data: {
          documentType: "INVOICE",
          terminalId: terminal.id,
          cai: "ABC123-CAI",
          prefix: "000-001-01-",
          rangeStart: 1,
          rangeEnd: 1000,
          nextNumber: 1,
          expiresAt,
        },
      })
    ).id;
    noteRangeId = (
      await testDb.fiscalRange.create({
        data: {
          documentType: "CREDIT_NOTE",
          terminalId: terminal.id,
          cai: "XYZ789-CAI",
          prefix: "000-001-03-",
          rangeStart: 1,
          rangeEnd: 1000,
          nextNumber: 1,
          expiresAt,
        },
      })
    ).id;

    let shiftId = (await openCashSession(cashier, { openingFloatCents: 80000 }, testDb)).id;
    let counter = 0;
    const requestId = () => `request-p4-${(counter += 1)}`;
    const replayable: (() => Promise<void>)[] = [];

    const balanceOf = async (customerId: string) =>
      (await testDb.customer.findUniqueOrThrow({ where: { id: customerId } })).storeCreditCents;
    const cashAvailable = async () => expectedCashCents(await loadCashTotals(testDb, shiftId));

    // Una venta con cliente, factura o crédito de tienda según el azar
    async function sellOnce(): Promise<void> {
      const seller = pick(sellers);
      const lines = Array.from({ length: int(1, 3) }, () => ({
        product: pick(products),
        quantity: int(1, 3),
      }));
      const priced = priceCart(
        lines.map((line) => ({
          unitPriceCents: line.product.priceCents,
          quantity: line.quantity,
          taxRateBps: line.product.exempt ? 0 : 1500,
        })),
        { pricesIncludeTax: true },
      );
      const total = priced.totalCents;
      const customer = chance(0.6) ? pick(customers) : null;
      let payments: object[];
      let usesCredit = false;
      const balance = customer ? await balanceOf(customer.id) : 0;
      if (customer && balance > 0 && chance(0.5)) {
        const credit = Math.min(balance, total);
        usesCredit = true;
        payments =
          credit === total
            ? [{ method: "STORE_CREDIT", amountCents: credit }]
            : [
                { method: "STORE_CREDIT", amountCents: credit },
                { method: "CASH", amountCents: total - credit + int(0, 2000) },
              ];
      } else {
        payments = pick([
          () => [{ method: "CASH", amountCents: total + int(0, 5000) }],
          () => [{ method: "CARD", amountCents: total, reference: "4242" }],
          () => [{ method: "TRANSFER", amountCents: total, reference: "T-77" }],
        ])();
      }
      const id = requestId();
      const input = {
        clientRequestId: id,
        lines: lines.map((line) => ({
          variantId: line.product.variantId,
          quantity: line.quantity,
        })),
        payments,
        ...(customer ? { customerId: customer.id } : {}),
        ...(chance(0.3)
          ? { invoice: { taxId: "0801-1999-00001", name: "Cliente de prueba" } }
          : {}),
      };
      try {
        await completeSale(seller, input, testDb);
        outcome.sold += 1;
        if (usesCredit) {
          outcome.creditSales += 1;
        }
        replayable.push(async () => {
          const again = await completeSale(seller, input, testDb);
          expect(again.replayed).toBe(true);
        });
      } catch (error) {
        if (error instanceof InsufficientStockError || error instanceof InsufficientCreditError) {
          outcome.skipped += 1;
          return;
        }
        throw error;
      }
    }

    /** Una línea de una venta completada que todavía se puede devolver. */
    async function returnableLine() {
      const sales = await testDb.sale.findMany({
        where: { status: "COMPLETED" },
        orderBy: { createdAt: "desc" },
        take: 40,
        select: {
          id: true,
          customerId: true,
          items: { select: { id: true, quantity: true, lineTotalCents: true } },
        },
      });
      if (sales.length === 0) {
        return null;
      }
      const sale = pick(sales);
      const returned = await testDb.returnItem.groupBy({
        by: ["saleItemId"],
        where: { saleItemId: { in: sale.items.map((item) => item.id) } },
        _sum: { quantity: true },
      });
      const before = new Map(returned.map((row) => [row.saleItemId, row._sum.quantity ?? 0]));
      const open = sale.items.filter((item) => item.quantity - (before.get(item.id) ?? 0) > 0);
      if (open.length === 0) {
        return null;
      }
      const item = pick(open);
      const already = before.get(item.id) ?? 0;
      return {
        sale,
        item,
        already,
        quantity: int(1, item.quantity - already),
        customerId: sale.customerId ?? pick(customers).id,
      };
    }

    async function returnOnce(): Promise<void> {
      const line = await returnableLine();
      if (!line) {
        return;
      }
      const value = valueOfUnits(
        line.item.lineTotalCents,
        line.item.quantity,
        line.already,
        line.quantity,
      );
      // Un reembolso en efectivo (solo un gerente) únicamente si hay en el cajón
      const cashRefund = chance(0.2) && (await cashAvailable()) >= value;
      const actor = cashRefund ? manager : pick([cashier, cashier2, manager]);
      const input = {
        clientRequestId: requestId(),
        saleId: line.sale.id,
        items: [
          {
            saleItemId: line.item.id,
            quantity: line.quantity,
            condition: chance(0.25) ? ("DAMAGED" as const) : ("RESELLABLE" as const),
          },
        ],
        reason: "Devolución de prueba",
        refundMethod: cashRefund ? ("CASH" as const) : ("STORE_CREDIT" as const),
        customerId: line.customerId,
      };
      try {
        await processReturn(actor, input, testDb);
        outcome.returns += 1;
        if (cashRefund) {
          outcome.cashRefunds += 1;
        }
        replayable.push(async () => {
          const again = await processReturn(actor, input, testDb);
          expect(again.replayed).toBe(true);
        });
      } catch (error) {
        if (error instanceof InsufficientCashError) {
          outcome.skipped += 1;
          return;
        }
        throw error;
      }
    }

    async function exchangeOnce(): Promise<void> {
      const line = await returnableLine();
      if (!line) {
        return;
      }
      const value = valueOfUnits(
        line.item.lineTotalCents,
        line.item.quantity,
        line.already,
        line.quantity,
      );
      const target = pick(products);
      const newTotal = priceCart(
        [{ unitPriceCents: target.priceCents, quantity: 1, taxRateBps: target.exempt ? 0 : 1500 }],
        { pricesIncludeTax: true },
      ).totalCents;
      const payable = Math.max(0, newTotal - value);
      const actor = pick([cashier, cashier2, manager]);
      const input = {
        clientRequestId: requestId(),
        saleId: line.sale.id,
        items: [
          { saleItemId: line.item.id, quantity: line.quantity, condition: "RESELLABLE" as const },
        ],
        reason: "Cambio de prueba",
        newLines: [{ variantId: target.variantId, quantity: 1 }],
        payments:
          payable > 0 ? [{ method: "CASH" as const, amountCents: payable + int(0, 1500) }] : [],
        customerId: line.customerId,
        ...(chance(0.3)
          ? { invoice: { taxId: "0801-1999-00001", name: "Cliente de prueba" } }
          : {}),
      };
      try {
        await processExchange(actor, input, testDb);
        outcome.exchanges += 1;
      } catch (error) {
        if (error instanceof InsufficientStockError) {
          outcome.skipped += 1;
          return;
        }
        throw error;
      }
    }

    async function layawayCreateOnce(): Promise<void> {
      const chosen = [pick(products), pick(products)].filter(
        (product, index, all) =>
          all.findIndex((other) => other.variantId === product.variantId) === index,
      );
      const lines = chosen.map((product) => ({
        variantId: product.variantId,
        quantity: int(1, 2),
      }));
      const total = priceCart(
        lines.map((line, index) => ({
          unitPriceCents: (chosen[index] as Product).priceCents,
          quantity: line.quantity,
          taxRateBps: (chosen[index] as Product).exempt ? 0 : 1500,
        })),
        { pricesIncludeTax: true },
      ).totalCents;
      const minimum = percentOf(total, 2000);
      const deposit = Math.min(total, minimum + int(0, Math.floor((total - minimum) / 2)));
      const actor = pick([cashier, cashier2, manager]);
      // Algunos nacen ya vencidos (de hace 40 días): el vencimiento los encuentra después
      const now = chance(0.15) ? addLocalDays(new Date(), -40) : new Date();
      const input = {
        clientRequestId: requestId(),
        customerId: pick(customers).id,
        lines,
        deposit: { method: pick(["CASH", "CARD"] as const), amountCents: deposit },
      };
      try {
        await createLayaway(actor, input, testDb, now);
        outcome.layawaysCreated += 1;
        replayable.push(async () => {
          const again = await createLayaway(actor, input, testDb, now);
          expect(again.replayed).toBe(true);
        });
      } catch (error) {
        if (error instanceof InsufficientStockError) {
          outcome.skipped += 1;
          return;
        }
        throw error;
      }
    }

    async function activeLayaway() {
      const rows = await testDb.layaway.findMany({
        where: { status: "ACTIVE", expiresAt: { gte: new Date() } },
        take: 20,
      });
      return rows.length > 0 ? pick(rows) : null;
    }

    for (let step = 0; step < OPERATIONS; step += 1) {
      const roll = random();
      if (roll < 0.27) {
        await sellOnce();
      } else if (roll < 0.37) {
        await returnOnce();
      } else if (roll < 0.43) {
        await exchangeOnce();
      } else if (roll < 0.51) {
        await layawayCreateOnce();
      } else if (roll < 0.57) {
        const layaway = await activeLayaway();
        const balance = layaway ? layaway.totalCents - layaway.paidCents : 0;
        if (layaway && balance > 0) {
          await addLayawayPayment(
            pick([cashier, cashier2, manager]),
            {
              clientRequestId: requestId(),
              layawayId: layaway.id,
              payment: {
                method: pick(["CASH", "CARD", "TRANSFER"] as const),
                amountCents: int(1, balance),
              },
            },
            testDb,
          );
          outcome.layawayPayments += 1;
        }
      } else if (roll < 0.62) {
        const layaway = await activeLayaway();
        if (layaway) {
          const balance = layaway.totalCents - layaway.paidCents;
          try {
            await settleLayaway(
              pick([cashier, cashier2, manager]),
              {
                clientRequestId: requestId(),
                layawayId: layaway.id,
                payments:
                  balance > 0 ? [{ method: "CASH", amountCents: balance + int(0, 1000) }] : [],
              },
              testDb,
            );
            outcome.layawaysSettled += 1;
          } catch (error) {
            if (!(error instanceof InsufficientStockError)) {
              throw error;
            }
            outcome.skipped += 1;
          }
        }
      } else if (roll < 0.65) {
        const layaway = await activeLayaway();
        if (layaway) {
          await cancelLayaway(
            manager,
            {
              layawayId: layaway.id,
              reason: "Cancelación de prueba",
              retainCents: chance(0.4) ? Math.floor(layaway.paidCents / 4) : 0,
            },
            testDb,
          );
          outcome.layawaysCancelled += 1;
        }
      } else if (roll < 0.68) {
        outcome.layawaysExpired += await expireOverdueLayaways(manager, testDb);
      } else if (roll < 0.73) {
        // Ajuste manual del crédito de un cliente
        const customer = pick(customers);
        const balance = await balanceOf(customer.id);
        const subtract = balance > 100 && chance(0.4);
        await adjustStoreCredit(
          manager,
          {
            requestId: requestId(),
            customerId: customer.id,
            direction: subtract ? "SUBTRACT" : "ADD",
            amountCents: subtract ? int(1, Math.min(balance, 5000)) : int(100, 6000),
            reason: "Ajuste de prueba",
          },
          testDb,
        );
        outcome.adjustments += 1;
      } else if (roll < 0.78) {
        // Anular una venta del turno abierto que no tenga devoluciones, cambios ni apartado
        const candidates = await testDb.sale.findMany({
          where: { status: "COMPLETED", cashSessionId: shiftId },
          select: { id: true },
          take: 30,
        });
        const eligible: string[] = [];
        for (const candidate of candidates) {
          const linked =
            (await testDb.returnDoc.count({
              where: { OR: [{ saleId: candidate.id }, { exchangeSaleId: candidate.id }] },
            })) + (await testDb.layaway.count({ where: { saleId: candidate.id } }));
          if (linked === 0) {
            eligible.push(candidate.id);
          }
        }
        if (eligible.length > 0) {
          await voidSale(manager, pick(eligible), { reason: "Anulación de prueba" }, testDb);
          outcome.voided += 1;
        }
      } else if (roll < 0.83) {
        const available = await cashAvailable();
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
      } else if (roll < 0.87) {
        const expected = await cashAvailable();
        const difference = pick([0, 0, -500, 300]);
        await submitCashClose(
          cashier,
          {
            countedCashCents: Math.max(0, expected + difference),
            ...(expected + difference !== expected ? { notes: "Diferencia de prueba" } : {}),
          },
          testDb,
        );
        await approveCashClose(manager, shiftId, testDb);
        shiftId = (await openCashSession(cashier, { openingFloatCents: int(0, 90000) }, testDb)).id;
        outcome.closes += 1;
      } else if (roll < 0.9) {
        await testDb.$transaction((tx) =>
          recordMovement(tx, {
            variantId: pick(products).variantId,
            locationId: location.id,
            userId: manager.id,
            type: "ADJUSTMENT_IN",
            quantity: int(1, 10),
            reason: "Ajuste de prueba",
          }),
        );
        outcome.stockAdjustments += 1;
      } else if (replayable.length > 0) {
        // Reintento de algo ya hecho (doble clic, red caída): no debe duplicar nada
        await pick(replayable)();
        outcome.replays += 1;
      } else {
        await sellOnce();
      }
    }
  }, 600_000);

  afterAll(async () => {
    await db.$disconnect();
    await closeDatabase();
  });

  it("ran a meaningful mix of operations", () => {
    expect(outcome.sold).toBeGreaterThan(25);
    expect(outcome.creditSales).toBeGreaterThan(2);
    expect(outcome.returns).toBeGreaterThan(8);
    expect(outcome.cashRefunds).toBeGreaterThan(0);
    expect(outcome.exchanges).toBeGreaterThan(3);
    expect(outcome.layawaysCreated).toBeGreaterThan(8);
    expect(outcome.layawayPayments).toBeGreaterThan(2);
    expect(outcome.layawaysSettled).toBeGreaterThan(1);
    expect(outcome.layawaysCancelled).toBeGreaterThan(0);
    expect(outcome.layawaysExpired).toBeGreaterThan(0);
    expect(outcome.adjustments).toBeGreaterThan(3);
    expect(outcome.voided).toBeGreaterThan(1);
    expect(outcome.closes).toBeGreaterThan(1);
    expect(outcome.replays).toBeGreaterThan(2);
  });

  it("#1 Σ StockMovement = onHand, Σ layaway movements = reserved = what active layaways ask for", async () => {
    expect(await findStockDiscrepancies(testDb)).toEqual([]);
    expect(await findReservedDiscrepancies(testDb)).toEqual([]);
    const levels = await testDb.stockLevel.findMany();
    const active = await testDb.layawayItem.groupBy({
      by: ["variantId"],
      where: { layaway: { status: "ACTIVE" } },
      _sum: { quantity: true },
    });
    for (const level of levels) {
      expect(level.onHand, "onHand").toBeGreaterThanOrEqual(0);
      expect(level.reserved, "reserved").toBe(
        active.find((row) => row.variantId === level.variantId)?._sum.quantity ?? 0,
      );
      expect(level.onHand - level.reserved, "available").toBeGreaterThanOrEqual(0);
    }
  });

  it("#2 Σ Payment − change = Sale.total for every sale, exchanges and layaway sales included", async () => {
    const sales = await testDb.sale.findMany({ include: { payments: true, items: true } });
    for (const sale of sales) {
      const paid = sale.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
      expect(paid).toBe(sale.paidCents);
      expect(paid - sale.changeCents).toBe(sale.totalCents);
      expect(sale.items.reduce((sum, item) => sum + item.lineTotalCents, 0)).toBe(sale.totalCents);
    }
    // El pago "Cambio" de una venta de cambio es lo devuelto menos lo que sobró; el de un apartado, lo abonado
    const exchanges = await testDb.returnDoc.findMany({
      where: { type: "EXCHANGE" },
      include: { items: true },
    });
    expect(exchanges.length).toBe(outcome.exchanges);
    for (const doc of exchanges) {
      const value = doc.items.reduce((sum, item) => sum + item.refundCents, 0);
      const applied = await testDb.payment.findFirst({
        where: { saleId: doc.exchangeSaleId as string, method: "EXCHANGE" },
      });
      expect(applied?.amountCents ?? 0).toBe(value - doc.refundCents);
    }
    for (const layaway of await testDb.layaway.findMany({ where: { status: "COMPLETED" } })) {
      const applied = await testDb.payment.findFirst({
        where: { saleId: layaway.saleId as string, method: "LAYAWAY" },
      });
      expect(applied?.amountCents ?? 0).toBe(layaway.paidCents);
      const sale = await testDb.sale.findUniqueOrThrow({ where: { id: layaway.saleId as string } });
      expect(sale.totalCents).toBe(layaway.totalCents);
      expect(sale.status).toBe("COMPLETED");
    }
  });

  it("#3 never returns more than was sold, nor more money than was paid", async () => {
    expect(await findOverReturns(testDb)).toEqual([]);
    const lines = await testDb.saleItem.findMany({
      where: { returnItems: { some: {} } },
      include: { returnItems: true },
    });
    expect(lines.length).toBeGreaterThan(5);
    for (const line of lines) {
      const units = line.returnItems.reduce((sum, item) => sum + item.quantity, 0);
      const money = line.returnItems.reduce((sum, item) => sum + item.refundCents, 0);
      expect(units).toBeLessThanOrEqual(line.quantity);
      expect(money).toBeLessThanOrEqual(line.lineTotalCents);
      // Devolverla toda devuelve exactamente lo pagado
      if (units === line.quantity) {
        expect(money).toBe(line.lineTotalCents);
      }
    }
  });

  it("#4 ticket, return, layaway and fiscal numbers have no gaps and no repeats", async () => {
    const sequence = async (key: string, numbers: string[], prefix: string) => {
      const values = numbers.map((n) => Number(n.replace(`${prefix}-`, ""))).sort((a, b) => a - b);
      expect(values, key).toEqual(Array.from({ length: values.length }, (_, index) => index + 1));
      const counter = await testDb.documentCounter.findUnique({ where: { key } });
      expect(counter?.nextValue ?? 1, `${key} counter`).toBe(values.length + 1);
    };
    await sequence(
      "SALE",
      (await testDb.sale.findMany()).map((s) => s.number),
      "T",
    );
    await sequence(
      "RETURN",
      (await testDb.returnDoc.findMany()).map((d) => d.number),
      "DV",
    );
    await sequence(
      "LAYAWAY",
      (await testDb.layaway.findMany()).map((l) => l.number),
      "AP",
    );

    const invoices = (await testDb.sale.findMany({ where: { fiscalNumber: { not: null } } }))
      .map((sale) => sale.fiscalNumber as number)
      .sort((a, b) => a - b);
    expect(invoices.length).toBeGreaterThan(5);
    expect(invoices).toEqual(Array.from({ length: invoices.length }, (_, index) => index + 1));
    expect(
      (await testDb.fiscalRange.findUniqueOrThrow({ where: { id: invoiceRangeId } })).nextNumber,
    ).toBe(invoices.length + 1);

    // Cada devolución de una venta facturada tiene su nota de crédito, correlativa
    const notes = (await testDb.returnDoc.findMany({ where: { fiscalNumber: { not: null } } }))
      .map((doc) => doc.fiscalNumber as number)
      .sort((a, b) => a - b);
    expect(notes.length).toBeGreaterThan(2);
    expect(notes).toEqual(Array.from({ length: notes.length }, (_, index) => index + 1));
    expect(
      (await testDb.fiscalRange.findUniqueOrThrow({ where: { id: noteRangeId } })).nextNumber,
    ).toBe(notes.length + 1);
    for (const doc of await testDb.returnDoc.findMany({ include: { sale: true } })) {
      expect(doc.fiscalNumber !== null, doc.number).toBe(doc.sale.fiscalNumber !== null);
    }
  });

  it("#5 every customer's credit equals their ledger, and it never goes negative", async () => {
    expect(await findCreditDiscrepancies(testDb)).toEqual([]);
    const entries = await testDb.storeCreditEntry.findMany();
    expect(entries.length).toBeGreaterThan(10);
    // Cada movimiento nace de un documento real que dice lo mismo
    for (const entry of entries) {
      if (entry.reason === "USED_IN_SALE") {
        const spent = await testDb.payment.aggregate({
          _sum: { amountCents: true },
          where: { saleId: entry.refId as string, method: "STORE_CREDIT" },
        });
        expect(spent._sum.amountCents).toBe(-entry.amountCents);
      } else if (entry.reason === "RETURN") {
        const doc = await testDb.returnDoc.findUniqueOrThrow({
          where: { id: entry.refId as string },
        });
        expect(doc.refundMethod).toBe("STORE_CREDIT");
        expect(doc.refundCents).toBe(entry.amountCents);
      } else if (entry.reason === "LAYAWAY_CANCEL") {
        const layaway = await testDb.layaway.findUniqueOrThrow({
          where: { id: entry.refId as string },
        });
        expect(["CANCELLED", "EXPIRED"]).toContain(layaway.status);
        expect(layaway.paidCents - layaway.retainedCents).toBe(entry.amountCents);
      } else if (entry.reason === "SALE_VOID") {
        const sale = await testDb.sale.findUniqueOrThrow({ where: { id: entry.refId as string } });
        expect(sale.status).toBe("VOIDED");
      } else {
        expect(entry.reason).toBe("MANUAL");
      }
    }
  });

  it("#6 each shift's expected cash includes layaway deposits and subtracts cash refunds", async () => {
    const sessions = await testDb.cashSession.findMany({
      include: {
        movements: true,
        payments: { include: { sale: true } },
        sales: true,
        layawayPayments: true,
      },
    });
    expect(sessions.length).toBeGreaterThan(1);
    let layawayCash = 0;
    let cashRefunds = 0;
    for (const session of sessions) {
      const cashIn = session.payments
        .filter((payment) => payment.method === "CASH" && payment.sale.status === "COMPLETED")
        .reduce((sum, payment) => sum + payment.amountCents, 0);
      const deposits = session.layawayPayments
        .filter((payment) => payment.method === "CASH")
        .reduce((sum, payment) => sum + payment.amountCents, 0);
      const change = session.sales
        .filter((sale) => sale.status === "COMPLETED")
        .reduce((sum, sale) => sum + sale.changeCents, 0);
      const refunds = (
        await testDb.returnDoc.findMany({
          where: { cashSessionId: session.id, refundMethod: "CASH" },
        })
      ).reduce((sum, doc) => sum + doc.refundCents, 0);
      const moved = (type: "IN" | "OUT") =>
        session.movements.filter((m) => m.type === type).reduce((sum, m) => sum + m.amountCents, 0);
      const expected =
        session.openingFloatCents +
        cashIn +
        deposits -
        change +
        moved("IN") -
        moved("OUT") -
        refunds;
      layawayCash += deposits;
      cashRefunds += refunds;

      expect(expected).toBeGreaterThanOrEqual(0);
      expect(expectedCashCents(await loadCashTotals(testDb, session.id))).toBe(expected);
      if (session.status !== "OPEN") {
        expect(session.expectedCashCents).toBe(expected);
        expect(session.differenceCents).toBe((session.countedCashCents as number) - expected);
      }
    }
    expect(layawayCash).toBeGreaterThan(0);
    expect(cashRefunds).toBeGreaterThan(0);
  });

  it("#7 a voided sale puts back what it took out and gives back the credit it spent", async () => {
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
      const spent = await testDb.storeCreditEntry.aggregate({
        _sum: { amountCents: true },
        where: { refType: "Sale", refId: sale.id },
      });
      expect(spent._sum.amountCents ?? 0).toBe(0);
    }
  });

  it("layaways keep their own books: deposits add up, closed ones released their reservation", async () => {
    const layaways = await testDb.layaway.findMany({ include: { payments: true, items: true } });
    for (const layaway of layaways) {
      expect(layaway.payments.reduce((sum, p) => sum + p.amountCents, 0)).toBe(layaway.paidCents);
      expect(layaway.paidCents).toBeLessThanOrEqual(layaway.totalCents);
      const reserved = await testDb.stockMovement.aggregate({
        _sum: { quantity: true },
        where: { refType: "Layaway", refId: layaway.id },
      });
      // Activo: sigue reservado; cualquier otro estado: lo reservado y lo liberado se anulan
      const units = layaway.items.reduce((sum, item) => sum + item.quantity, 0);
      expect(reserved._sum.quantity ?? 0).toBe(layaway.status === "ACTIVE" ? units : 0);
      if (layaway.status === "COMPLETED") {
        expect(layaway.saleId).not.toBeNull();
      } else {
        expect(layaway.saleId).toBeNull();
      }
    }
    expect(layaways.length).toBe(outcome.layawaysCreated);
    expect(layaways.filter((l) => l.status === "COMPLETED").length).toBe(outcome.layawaysSettled);
    expect(layaways.filter((l) => l.status === "CANCELLED").length).toBe(outcome.layawaysCancelled);
    expect(layaways.filter((l) => l.status === "EXPIRED").length).toBe(outcome.layawaysExpired);
  });

  it("a replay never created a second document", async () => {
    for (const table of ["sale", "returnDoc", "layaway"] as const) {
      const delegate = testDb[table] as unknown as {
        count: () => Promise<number>;
        groupBy: (args: { by: ["clientRequestId"] }) => Promise<unknown[]>;
      };
      expect((await delegate.groupBy({ by: ["clientRequestId"] })).length).toBe(
        await delegate.count(),
      );
    }
  });

  it("the detectors report what they should when a book is out of line", async () => {
    class Rollback extends Error {}
    // Un movimiento del libro sin su saldo
    const customer = await testDb.customer.findFirstOrThrow();
    const user = await testDb.user.findFirstOrThrow();
    await expect(
      testDb.$transaction(async (tx) => {
        await tx.storeCreditEntry.create({
          data: { customerId: customer.id, amountCents: 1, reason: "MANUAL", userId: user.id },
        });
        const found = await findCreditDiscrepancies(tx);
        expect(found.map((row) => row.customerId)).toEqual([customer.id]);
        expect(found[0]?.ledgerCents).toBe((found[0]?.cachedCents ?? 0) + 1);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
    // Una devolución de más
    const line = await testDb.saleItem.findFirstOrThrow({ where: { returnItems: { some: {} } } });
    const doc = await testDb.returnDoc.findFirstOrThrow({
      where: { items: { some: { saleItemId: line.id } } },
    });
    await expect(
      testDb.$transaction(async (tx) => {
        await tx.returnItem.create({
          data: {
            returnId: doc.id,
            saleItemId: line.id,
            quantity: line.quantity + 1,
            condition: "RESELLABLE",
            refundCents: 1,
          },
        });
        const found = await findOverReturns(tx);
        expect(found.map((row) => row.saleItemId)).toContain(line.id);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
    // Una reserva sin movimiento
    const level = await testDb.stockLevel.findFirstOrThrow();
    await expect(
      testDb.$transaction(async (tx) => {
        await tx.stockLevel.update({
          where: { id: level.id },
          data: { reserved: { increment: 1 } },
        });
        expect((await findReservedDiscrepancies(tx)).map((row) => row.variantId)).toContain(
          level.variantId,
        );
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
    // y después de deshacer todo, nada
    expect(await findCreditDiscrepancies(testDb)).toEqual([]);
    expect(await findOverReturns(testDb)).toEqual([]);
    expect(await findReservedDiscrepancies(testDb)).toEqual([]);
  });

  // Sin esto el compilador no ve LayawayStateError usado: lo cubre el vencimiento en la secuencia
  it("closed layaways refuse more deposits", async () => {
    const closed = await testDb.layaway.findFirstOrThrow({
      where: { status: { in: ["CANCELLED", "EXPIRED"] } },
    });
    const user = await testDb.user.findFirstOrThrow({ where: { username: "cashier" } });
    await expect(
      addLayawayPayment(
        { id: user.id, role: "CASHIER" },
        {
          clientRequestId: "request-p4-closed",
          layawayId: closed.id,
          payment: { method: "CASH", amountCents: 1 },
        },
        testDb,
      ),
    ).rejects.toBeInstanceOf(LayawayStateError);
  });
});
