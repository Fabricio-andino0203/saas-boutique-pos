import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { addLocalDays, endOfLocalDay } from "@/lib/dates";
import { db } from "@/lib/db";
import {
  CashSessionClosedError,
  ForbiddenError,
  InsufficientStockError,
  InvalidCredentialsError,
  LayawayDepositError,
  LayawayStateError,
  NotFoundError,
  SaleStateError,
  ValidationError,
} from "@/lib/errors";
import { hashSecret } from "@/lib/password";
import type { Role } from "@/lib/permissions";
import { expectedCashCents } from "@/modules/cash/expected";
import { loadCashTotals, openCashSession } from "@/modules/cash/service";
import { findReservedDiscrepancies, findStockDiscrepancies } from "@/modules/inventory/reconcile";
import { recordMovement } from "@/modules/inventory/service";
import {
  addLayawayPayment,
  cancelLayaway,
  createLayaway,
  expireOverdueLayaways,
  settleLayaway,
} from "@/modules/layaways/service";
import { lookupCode, searchSellable } from "@/modules/sales/pos-queries";
import { completeSale, voidSale } from "@/modules/sales/service";

import { closeDatabase, resetDatabase, testDb } from "./helpers/db";

const closeAll = async () => {
  await db.$disconnect();
  await closeDatabase();
};

type Actor = { id: string; role: Role };

const MANAGER_PIN = { username: "manager", pin: "2222" };
let managerPinHash: Promise<string> | undefined;

async function world(options: { openShift?: boolean } = {}) {
  managerPinHash ??= hashSecret(MANAGER_PIN.pin);
  const make = async (username: string, role: Role, pinHash?: string): Promise<Actor> => {
    const user = await testDb.user.create({
      data: { name: `Nombre ${username}`, username, passwordHash: "x", role, pinHash },
    });
    return { id: user.id, role };
  };
  const owner = await make("owner", "OWNER");
  const manager = await make("manager", "MANAGER", await managerPinHash);
  const cashier = await make("cashier", "CASHIER");
  const warehouse = await make("warehouse", "WAREHOUSE");

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
      data: { productId: product.id, sku: code, barcode: `BC-${code}`, avgCostCents: 4000 },
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
    return { ...created, productId: product.id };
  };
  const dress = await variant("VES1", 10000, 5);
  const shirt = await variant("CAM1", 20000, 1);
  const ana = await testDb.customer.create({ data: { name: "Ana Pérez", phone: "9999-0000" } });
  const shift =
    options.openShift === false
      ? null
      : await openCashSession(cashier, { openingFloatCents: 50000 }, testDb);
  return {
    owner,
    manager,
    cashier,
    warehouse,
    dress,
    shirt,
    ana,
    location,
    shiftId: shift?.id ?? "",
  };
}

type World = Awaited<ReturnType<typeof world>>;

let seq = 0;
const requestId = () => `request-lay-${(seq += 1)}`;

const cash = (amountCents: number) => ({ method: "CASH" as const, amountCents });

function create(
  w: World,
  lines: { variantId: string; quantity: number }[],
  deposit = cash(2000),
  opts: { id?: string; actor?: Actor; now?: Date; customerId?: string } = {},
) {
  return createLayaway(
    opts.actor ?? w.cashier,
    {
      clientRequestId: opts.id ?? requestId(),
      customerId: opts.customerId ?? w.ana.id,
      lines,
      deposit,
    },
    testDb,
    opts.now,
  );
}

const oneDress = (w: World) => [{ variantId: w.dress.id, quantity: 1 }];

const stock = async (variantId: string) => {
  const level = await testDb.stockLevel.findFirstOrThrow({ where: { variantId } });
  return { onHand: level.onHand, reserved: level.reserved };
};

const pay = (w: World, layawayId: string, amountCents: number, id = requestId()) =>
  addLayawayPayment(
    w.cashier,
    { clientRequestId: id, layawayId, payment: cash(amountCents) },
    testDb,
  );

const settle = (w: World, layawayId: string, payments: object[], id = requestId()) =>
  settleLayaway(w.cashier, { clientRequestId: id, layawayId, payments }, testDb);

async function expectReservationsConsistent() {
  expect(await findReservedDiscrepancies(testDb)).toEqual([]);
  expect(await findStockDiscrepancies(testDb)).toEqual([]);
  // lo reservado es exactamente lo que piden los apartados activos
  const active = await testDb.layawayItem.groupBy({
    by: ["variantId"],
    where: { layaway: { status: "ACTIVE" } },
    _sum: { quantity: true },
  });
  const levels = await testDb.stockLevel.findMany();
  for (const level of levels) {
    const wanted = active.find((row) => row.variantId === level.variantId)?._sum.quantity ?? 0;
    expect(level.reserved, level.variantId).toBe(wanted);
  }
}

describe("createLayaway", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("reserves the garments without moving the physical stock and takes the first deposit", async () => {
    const w = await world();
    const now = new Date();
    const result = await create(w, oneDress(w), cash(3000), { now });

    expect(result).toMatchObject({
      number: "AP-000001",
      totalCents: 10000,
      paidCents: 3000,
      balanceCents: 7000,
      replayed: false,
    });
    expect(result.expiresAt).toEqual(endOfLocalDay(addLocalDays(now, 30)));
    expect(await stock(w.dress.id)).toEqual({ onHand: 5, reserved: 1 });

    const layaway = await testDb.layaway.findUniqueOrThrow({
      where: { id: result.id },
      include: { items: true, payments: true },
    });
    expect(layaway).toMatchObject({
      status: "ACTIVE",
      customerId: w.ana.id,
      createdById: w.cashier.id,
      paidCents: 3000,
    });
    expect(layaway.items).toHaveLength(1);
    expect(layaway.items[0]).toMatchObject({
      quantity: 1,
      unitPriceCents: 10000,
      productName: "Producto VES1",
      sku: "VES1",
    });
    expect(layaway.payments.map((p) => [p.method, p.amountCents, p.userId])).toEqual([
      ["CASH", 3000, w.cashier.id],
    ]);
    const movement = await testDb.stockMovement.findFirstOrThrow({
      where: { type: "LAYAWAY_RESERVE" },
    });
    expect(movement).toMatchObject({ quantity: 1, refType: "Layaway", refId: result.id });

    // El efectivo del abono está en el cajón
    const totals = await loadCashTotals(testDb, w.shiftId);
    expect(totals.layawayCashCents).toBe(3000);
    expect(expectedCashCents(totals)).toBe(53000);
    await expectReservationsConsistent();
  });

  it("asks for the minimum deposit and burns nothing when it is not enough", async () => {
    const w = await world();
    await expect(create(w, oneDress(w), cash(1999))).rejects.toBeInstanceOf(LayawayDepositError);
    expect(await testDb.layaway.count()).toBe(0);
    expect(await stock(w.dress.id)).toEqual({ onHand: 5, reserved: 0 });
    const ok = await create(w, oneDress(w), cash(2000));
    expect(ok.number).toBe("AP-000001");
    await expect(create(w, oneDress(w), cash(10001))).rejects.toBeInstanceOf(ValidationError);
  });

  it("needs an open shift", async () => {
    const w = await world({ openShift: false });
    await expect(create(w, oneDress(w))).rejects.toBeInstanceOf(CashSessionClosedError);
    expect(await testDb.layaway.count()).toBe(0);
    expect(await stock(w.dress.id)).toEqual({ onHand: 5, reserved: 0 });
  });

  it("only reserves what is available, all or nothing", async () => {
    const w = await world();
    await create(w, [{ variantId: w.shirt.id, quantity: 1 }], cash(4000));
    expect(await stock(w.shirt.id)).toEqual({ onHand: 1, reserved: 1 });
    await expect(
      create(
        w,
        [
          { variantId: w.dress.id, quantity: 1 },
          { variantId: w.shirt.id, quantity: 1 },
        ],
        cash(6000),
      ),
    ).rejects.toBeInstanceOf(InsufficientStockError);
    expect(await testDb.layaway.count()).toBe(1);
    expect(await stock(w.dress.id)).toEqual({ onHand: 5, reserved: 0 });
    await expectReservationsConsistent();
  });

  it("joins a repeated garment into one line and rejects unknown customers and garments", async () => {
    const w = await world();
    const result = await create(
      w,
      [
        { variantId: w.dress.id, quantity: 1 },
        { variantId: w.dress.id, quantity: 2 },
      ],
      cash(6000),
    );
    expect(result.totalCents).toBe(30000);
    expect(await testDb.layawayItem.count({ where: { layawayId: result.id } })).toBe(1);
    expect(await stock(w.dress.id)).toEqual({ onHand: 5, reserved: 3 });
    await expect(
      create(w, oneDress(w), cash(2000), { customerId: "no-existe" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(create(w, [{ variantId: "no-existe", quantity: 1 }])).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("is the same layaway when the request is sent again, even at once", async () => {
    const w = await world();
    const id = requestId();
    const results = await Promise.all(
      [1, 2, 3].map(() => create(w, oneDress(w), cash(2000), { id })),
    );
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(await testDb.layaway.count()).toBe(1);
    expect(await stock(w.dress.id)).toEqual({ onHand: 5, reserved: 1 });
  });

  it("is for people who can sell, not for the warehouse", async () => {
    const w = await world();
    await expect(create(w, oneDress(w), cash(2000), { actor: w.warehouse })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe("reserved garments are not for sale", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("lets a sale take only what is not reserved", async () => {
    const w = await world();
    await create(w, [{ variantId: w.dress.id, quantity: 4 }], cash(8000));
    const sell = (quantity: number) =>
      completeSale(
        w.cashier,
        {
          clientRequestId: requestId(),
          lines: [{ variantId: w.dress.id, quantity }],
          payments: [cash(10000 * quantity)],
        },
        testDb,
      );
    await expect(sell(2)).rejects.toBeInstanceOf(InsufficientStockError);
    await sell(1);
    await expect(sell(1)).rejects.toBeInstanceOf(InsufficientStockError);
    expect(await stock(w.dress.id)).toEqual({ onHand: 4, reserved: 4 });
    await expectReservationsConsistent();
  });
});

describe("what the counter sees", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("shows a reserved garment as not available, and gives it back when the layaway expires or is cancelled", async () => {
    const w = await world();
    const availableOf = async () => {
      const found = await searchSellable({ q: "VES1" });
      return found.flatMap((product) => product.variants).find((v) => v.variantId === w.dress.id)
        ?.onHand;
    };
    const byCode = async () => {
      const result = await lookupCode(w.dress.barcode as string);
      return result.kind === "variant" ? result.variant.onHand : null;
    };
    expect(await availableOf()).toBe(5);

    const layaway = await create(w, [{ variantId: w.dress.id, quantity: 2 }], cash(4000));
    expect(await availableOf()).toBe(3);
    expect(await byCode()).toBe(3);

    // Al cancelar vuelve a estar disponible
    await cancelLayaway(w.manager, { layawayId: layaway.id, reason: "Ya no lo quiere" }, testDb);
    expect(await availableOf()).toBe(5);

    // Y al vencer, también
    await create(w, [{ variantId: w.dress.id, quantity: 3 }], cash(6000), {
      now: addLocalDays(new Date(), -40),
    });
    expect(await availableOf()).toBe(2);
    await expireOverdueLayaways(w.cashier, testDb);
    expect(await availableOf()).toBe(5);
    expect(await byCode()).toBe(5);
  });
});

describe("addLayawayPayment", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("receives deposits until the balance is paid, each with its own receipt", async () => {
    const w = await world();
    const layaway = await create(w, oneDress(w), cash(2000));
    const first = await pay(w, layaway.id, 3000);
    expect(first).toMatchObject({ paidCents: 5000, balanceCents: 5000, replayed: false });
    const second = await pay(w, layaway.id, 5000);
    expect(second).toMatchObject({ paidCents: 10000, balanceCents: 0 });
    expect(first.paymentId).not.toBe(second.paymentId);
    const payments = await testDb.layawayPayment.findMany({ where: { layawayId: layaway.id } });
    expect(payments).toHaveLength(3);
    expect((await loadCashTotals(testDb, w.shiftId)).layawayCashCents).toBe(10000);
    await expect(pay(w, layaway.id, 1)).rejects.toBeInstanceOf(ValidationError);
  });

  it("does not receive more than the balance", async () => {
    const w = await world();
    const layaway = await create(w, oneDress(w), cash(2000));
    await expect(pay(w, layaway.id, 8001)).rejects.toBeInstanceOf(ValidationError);
    expect((await testDb.layaway.findUniqueOrThrow({ where: { id: layaway.id } })).paidCents).toBe(
      2000,
    );
  });

  it("registers a deposit once when the same request is sent again, even at once", async () => {
    const w = await world();
    const layaway = await create(w, oneDress(w), cash(2000));
    const id = requestId();
    const results = await Promise.all([1, 2, 3].map(() => pay(w, layaway.id, 3000, id)));
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(new Set(results.map((r) => r.paymentId)).size).toBe(1);
    expect((await testDb.layaway.findUniqueOrThrow({ where: { id: layaway.id } })).paidCents).toBe(
      5000,
    );
    expect(await testDb.layawayPayment.count({ where: { layawayId: layaway.id } })).toBe(2);
  });

  it("lets only what fits in the balance through when deposits race", async () => {
    const w = await world();
    const layaway = await create(w, oneDress(w), cash(2000));
    // El saldo es 8000: de tres abonos de 4000, entran dos
    const attempts = await Promise.allSettled([1, 2, 3].map(() => pay(w, layaway.id, 4000)));
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(2);
    for (const attempt of attempts) {
      if (attempt.status === "rejected") {
        expect(attempt.reason).toBeInstanceOf(ValidationError);
      }
    }
    expect((await testDb.layaway.findUniqueOrThrow({ where: { id: layaway.id } })).paidCents).toBe(
      10000,
    );
  });

  it("is refused once the layaway is closed or past its deadline", async () => {
    const w = await world();
    const layaway = await create(w, oneDress(w), cash(2000));
    await expect(
      addLayawayPayment(
        w.cashier,
        { clientRequestId: requestId(), layawayId: layaway.id, payment: cash(1000) },
        testDb,
        addLocalDays(new Date(), 40),
      ),
    ).rejects.toBeInstanceOf(LayawayStateError);
    await cancelLayaway(w.manager, { layawayId: layaway.id, reason: "Ya no lo quiere" }, testDb);
    await expect(pay(w, layaway.id, 1000)).rejects.toBeInstanceOf(LayawayStateError);
  });
});

describe("settleLayaway", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("turns the layaway into a sale at the price of the day it was reserved", async () => {
    const w = await world();
    const layaway = await create(w, oneDress(w), cash(3000));
    await pay(w, layaway.id, 2000);
    // El precio sube después de apartar: no se le cobra más
    await testDb.variant.update({ where: { id: w.dress.id }, data: { priceCents: 15000 } });

    const result = await settle(w, layaway.id, [cash(10000)]);
    // 5000 de los abonos + 10000 de hoy = 15000 recibidos, 5000 de vuelto
    expect(result.sale).toMatchObject({ totalCents: 10000, paidCents: 15000, changeCents: 5000 });
    expect(result.layawayNumber).toBe("AP-000001");

    const sale = await testDb.sale.findUniqueOrThrow({
      where: { id: result.sale.id },
      include: { payments: true, items: true },
    });
    expect(sale).toMatchObject({
      customerId: w.ana.id,
      status: "COMPLETED",
      sellerId: w.cashier.id,
    });
    expect(sale.items[0]).toMatchObject({ unitPriceCents: 10000, lineTotalCents: 10000 });
    // Σ pagos − vuelto = total: los abonos de antes (5000) + 10000 de hoy − 5000 de vuelto
    expect(
      sale.payments
        .map((p) => [p.method, p.amountCents])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ).toEqual([
      ["CASH", 10000],
      ["LAYAWAY", 5000],
    ]);
    expect(sale.payments.reduce((sum, p) => sum + p.amountCents, 0) - sale.changeCents).toBe(
      sale.totalCents,
    );

    expect(await stock(w.dress.id)).toEqual({ onHand: 4, reserved: 0 });
    const closed = await testDb.layaway.findUniqueOrThrow({ where: { id: layaway.id } });
    expect(closed).toMatchObject({ status: "COMPLETED", saleId: result.sale.id });

    // El cajón: el fondo + los abonos en efectivo (5000) + el cobro de hoy (10000) − el vuelto (5000); sin contar dos veces
    const totals = await loadCashTotals(testDb, w.shiftId);
    expect(totals).toMatchObject({
      layawayCashCents: 5000,
      cashPaymentsCents: 10000,
      changeGivenCents: 5000,
    });
    expect(expectedCashCents(totals)).toBe(60000);
    await expectReservationsConsistent();
  });

  it("can be settled with no payment when the deposits already covered everything", async () => {
    const w = await world();
    const layaway = await create(w, oneDress(w), cash(2000));
    await pay(w, layaway.id, 8000);
    const result = await settle(w, layaway.id, []);
    expect(result.sale).toMatchObject({ totalCents: 10000, paidCents: 10000, changeCents: 0 });
    expect(await stock(w.dress.id)).toEqual({ onHand: 4, reserved: 0 });
  });

  it("does nothing when what is left is not covered", async () => {
    const w = await world();
    const layaway = await create(w, oneDress(w), cash(2000));
    await expect(settle(w, layaway.id, [cash(7999)])).rejects.toBeInstanceOf(ValidationError);
    expect(await stock(w.dress.id)).toEqual({ onHand: 5, reserved: 1 });
    expect(await testDb.sale.count()).toBe(0);
    expect((await testDb.layaway.findUniqueOrThrow({ where: { id: layaway.id } })).status).toBe(
      "ACTIVE",
    );
    // y el ticket no se gastó
    const ok = await settle(w, layaway.id, [cash(8000)]);
    expect(ok.sale.number).toBe("T-000001");
  });

  it("can be paid with store credit", async () => {
    const w = await world();
    const layaway = await create(w, oneDress(w), cash(2000));
    await testDb.customer.update({ where: { id: w.ana.id }, data: { storeCreditCents: 8000 } });
    await testDb.storeCreditEntry.create({
      data: { customerId: w.ana.id, amountCents: 8000, reason: "MANUAL", userId: w.manager.id },
    });
    const result = await settle(w, layaway.id, [{ method: "STORE_CREDIT", amountCents: 8000 }]);
    expect(result.sale.paidCents).toBe(10000);
    expect(
      (await testDb.customer.findUniqueOrThrow({ where: { id: w.ana.id } })).storeCreditCents,
    ).toBe(0);
  });

  it("settles once: the same request replays, another one is refused", async () => {
    const w = await world();
    const layaway = await create(w, oneDress(w), cash(2000));
    const id = requestId();
    const first = await settle(w, layaway.id, [cash(8000)], id);
    const again = await settle(w, layaway.id, [cash(8000)], id);
    expect(first.replayed).toBe(false);
    expect(again).toEqual({ ...first, replayed: true });
    await expect(settle(w, layaway.id, [cash(8000)])).rejects.toBeInstanceOf(LayawayStateError);
    expect(await testDb.sale.count()).toBe(1);
    expect(await stock(w.dress.id)).toEqual({ onHand: 4, reserved: 0 });
  });

  it("does not settle twice when the button is pressed several times at once", async () => {
    const w = await world();
    const layaway = await create(w, oneDress(w), cash(2000));
    const id = requestId();
    const results = await Promise.all([1, 2, 3].map(() => settle(w, layaway.id, [cash(8000)], id)));
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(await testDb.sale.count()).toBe(1);
    expect(await stock(w.dress.id)).toEqual({ onHand: 4, reserved: 0 });
  });

  it("does not let the sale that settled a layaway be voided: its deposits are already collected", async () => {
    const w = await world();
    const layaway = await create(w, oneDress(w), cash(2000));
    const result = await settle(w, layaway.id, [cash(8000)]);
    await expect(
      voidSale(w.manager, result.sale.id, { reason: "Error del cajero" }, testDb),
    ).rejects.toBeInstanceOf(SaleStateError);
    expect((await testDb.sale.findUniqueOrThrow({ where: { id: result.sale.id } })).status).toBe(
      "COMPLETED",
    );
    expect(await stock(w.dress.id)).toEqual({ onHand: 4, reserved: 0 });
  });

  it("is refused after a layaway is cancelled or past its deadline", async () => {
    const w = await world();
    const layaway = await create(w, oneDress(w), cash(2000));
    await expect(
      settleLayaway(
        w.cashier,
        { clientRequestId: requestId(), layawayId: layaway.id, payments: [cash(8000)] },
        testDb,
        undefined,
        addLocalDays(new Date(), 40),
      ),
    ).rejects.toBeInstanceOf(LayawayStateError);
    await cancelLayaway(w.manager, { layawayId: layaway.id, reason: "Ya no lo quiere" }, testDb);
    await expect(settle(w, layaway.id, [cash(8000)])).rejects.toBeInstanceOf(LayawayStateError);
    expect(await testDb.sale.count()).toBe(0);
  });
});

describe("cancelLayaway", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("frees the garments and turns what was paid into store credit", async () => {
    const w = await world();
    const layaway = await create(w, oneDress(w), cash(3000));
    await pay(w, layaway.id, 1000);
    await cancelLayaway(w.manager, { layawayId: layaway.id, reason: "Cambió de opinión" }, testDb);

    expect(await stock(w.dress.id)).toEqual({ onHand: 5, reserved: 0 });
    const closed = await testDb.layaway.findUniqueOrThrow({ where: { id: layaway.id } });
    expect(closed).toMatchObject({
      status: "CANCELLED",
      retainedCents: 0,
      cancelReason: "Cambió de opinión",
      cancelledById: w.manager.id,
    });
    expect(
      (await testDb.customer.findUniqueOrThrow({ where: { id: w.ana.id } })).storeCreditCents,
    ).toBe(4000);
    const entry = await testDb.storeCreditEntry.findFirstOrThrow({
      where: { customerId: w.ana.id },
    });
    expect(entry).toMatchObject({
      amountCents: 4000,
      reason: "LAYAWAY_CANCEL",
      refType: "Layaway",
      refId: layaway.id,
    });
    const log = await testDb.auditLog.findFirstOrThrow({ where: { action: "LAYAWAY_CANCELLED" } });
    expect(log).toMatchObject({
      entityId: layaway.id,
      userId: w.manager.id,
      reason: "Cambió de opinión",
    });
    expect(log.after).toMatchObject({ status: "CANCELLED", creditedCents: 4000, retainedCents: 0 });
    // el efectivo de los abonos sigue en el cajón: se devolvió como crédito, no en efectivo
    expect((await loadCashTotals(testDb, w.shiftId)).layawayCashCents).toBe(4000);
    await expectReservationsConsistent();
  });

  it("lets the store keep part of what was paid", async () => {
    const w = await world();
    const layaway = await create(w, oneDress(w), cash(4000));
    await cancelLayaway(
      w.owner,
      { layawayId: layaway.id, reason: "No volvió", retainCents: 1000 },
      testDb,
    );
    expect(
      (await testDb.customer.findUniqueOrThrow({ where: { id: w.ana.id } })).storeCreditCents,
    ).toBe(3000);
    expect(
      (await testDb.layaway.findUniqueOrThrow({ where: { id: layaway.id } })).retainedCents,
    ).toBe(1000);
    const other = await create(w, oneDress(w), cash(2000));
    await expect(
      cancelLayaway(
        w.owner,
        { layawayId: other.id, reason: "No volvió", retainCents: 2001 },
        testDb,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect((await testDb.layaway.findUniqueOrThrow({ where: { id: other.id } })).status).toBe(
      "ACTIVE",
    );
    expect(await stock(w.dress.id)).toEqual({ onHand: 5, reserved: 1 });
  });

  it("asks a cashier for a manager's PIN", async () => {
    const w = await world();
    const layaway = await create(w, oneDress(w), cash(2000));
    await expect(
      cancelLayaway(w.cashier, { layawayId: layaway.id, reason: "Ya no lo quiere" }, testDb),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      cancelLayaway(
        w.cashier,
        {
          layawayId: layaway.id,
          reason: "Ya no lo quiere",
          managerOverride: { username: "manager", pin: "0000" },
        },
        testDb,
      ),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect((await testDb.layaway.findUniqueOrThrow({ where: { id: layaway.id } })).status).toBe(
      "ACTIVE",
    );

    await cancelLayaway(
      w.cashier,
      { layawayId: layaway.id, reason: "Ya no lo quiere", managerOverride: MANAGER_PIN },
      testDb,
    );
    const closed = await testDb.layaway.findUniqueOrThrow({ where: { id: layaway.id } });
    expect(closed).toMatchObject({ status: "CANCELLED", cancelledById: w.manager.id });
    const log = await testDb.auditLog.findFirstOrThrow({ where: { action: "LAYAWAY_CANCELLED" } });
    expect(log.userId).toBe(w.cashier.id);
    expect(log.after).toMatchObject({ authorizedById: w.manager.id });
  });

  it("cannot cancel one that is already closed", async () => {
    const w = await world();
    const layaway = await create(w, oneDress(w), cash(2000));
    await cancelLayaway(w.manager, { layawayId: layaway.id, reason: "Ya no lo quiere" }, testDb);
    await expect(
      cancelLayaway(w.manager, { layawayId: layaway.id, reason: "Otra vez" }, testDb),
    ).rejects.toBeInstanceOf(LayawayStateError);
    const done = await create(w, oneDress(w), cash(2000));
    await settle(w, done.id, [cash(8000)]);
    await expect(
      cancelLayaway(w.manager, { layawayId: done.id, reason: "Tarde" }, testDb),
    ).rejects.toBeInstanceOf(LayawayStateError);
    expect(
      (await testDb.customer.findUniqueOrThrow({ where: { id: w.ana.id } })).storeCreditCents,
    ).toBe(2000);
  });
});

describe("expireOverdueLayaways", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("expires only what is overdue, frees the garments and credits what was paid", async () => {
    const w = await world();
    const old = await create(w, oneDress(w), cash(5000), { now: addLocalDays(new Date(), -40) });
    const fresh = await create(w, oneDress(w), cash(2000));
    expect(await stock(w.dress.id)).toEqual({ onHand: 5, reserved: 2 });

    expect(await expireOverdueLayaways(w.cashier, testDb)).toBe(1);
    expect((await testDb.layaway.findUniqueOrThrow({ where: { id: old.id } })).status).toBe(
      "EXPIRED",
    );
    expect((await testDb.layaway.findUniqueOrThrow({ where: { id: fresh.id } })).status).toBe(
      "ACTIVE",
    );
    expect(await stock(w.dress.id)).toEqual({ onHand: 5, reserved: 1 });
    expect(
      (await testDb.customer.findUniqueOrThrow({ where: { id: w.ana.id } })).storeCreditCents,
    ).toBe(5000);
    const log = await testDb.auditLog.findFirstOrThrow({
      where: { action: "LAYAWAY_CANCELLED", entityId: old.id },
    });
    expect(log.after).toMatchObject({ status: "EXPIRED", creditedCents: 5000 });
    expect(log.reason).toBe("Venció el plazo del apartado");

    // Una segunda pasada no vence nada más ni acredita dos veces
    expect(await expireOverdueLayaways(w.cashier, testDb)).toBe(0);
    expect(
      (await testDb.customer.findUniqueOrThrow({ where: { id: w.ana.id } })).storeCreditCents,
    ).toBe(5000);
    await expectReservationsConsistent();
  });

  it("gives back exactly what was paid when a deposit and the expiry race", async () => {
    const w = await world();
    const layaway = await create(w, oneDress(w), cash(2000), {
      now: addLocalDays(new Date(), -40),
    });
    // El abono se hace "antes del plazo" (con una fecha de ayer) y el vencimiento, ahora
    const attempts = await Promise.allSettled([
      addLayawayPayment(
        w.cashier,
        { clientRequestId: requestId(), layawayId: layaway.id, payment: cash(3000) },
        testDb,
        addLocalDays(new Date(), -20),
      ),
      expireOverdueLayaways(w.manager, testDb),
    ]);
    for (const attempt of attempts) {
      if (attempt.status === "rejected") {
        expect(attempt.reason).toBeInstanceOf(LayawayStateError);
      }
    }
    const closed = await testDb.layaway.findUniqueOrThrow({ where: { id: layaway.id } });
    expect(closed.status).toBe("EXPIRED");
    // Lo acreditado es exactamente lo abonado, sea cual haya sido el orden
    expect(
      (await testDb.customer.findUniqueOrThrow({ where: { id: w.ana.id } })).storeCreditCents,
    ).toBe(closed.paidCents);
    expect(closed.paidCents === 2000 || closed.paidCents === 5000).toBe(true);
    await expectReservationsConsistent();
  });
});

describe("layaway invariants", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("keeps the reserved stock equal to the active layaways through a mixed sequence", async () => {
    const w = await world();
    const a = await create(w, [{ variantId: w.dress.id, quantity: 2 }], cash(4000));
    const b = await create(w, [{ variantId: w.shirt.id, quantity: 1 }], cash(4000));
    const c = await create(w, oneDress(w), cash(2000));
    await pay(w, a.id, 6000);
    await settle(w, a.id, [cash(10000)]);
    await cancelLayaway(w.manager, { layawayId: b.id, reason: "No lo quiere" }, testDb);
    await expectReservationsConsistent();
    expect(await stock(w.dress.id)).toEqual({ onHand: 3, reserved: 1 });
    expect(await stock(w.shirt.id)).toEqual({ onHand: 1, reserved: 0 });
    expect((await testDb.layaway.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("ACTIVE");

    for (const layaway of await testDb.layaway.findMany({ include: { payments: true } })) {
      expect(layaway.payments.reduce((sum, p) => sum + p.amountCents, 0)).toBe(layaway.paidCents);
      expect(layaway.paidCents).toBeLessThanOrEqual(layaway.totalCents);
    }
    for (const customer of await testDb.customer.findMany({
      include: { storeCreditEntries: true },
    })) {
      expect(customer.storeCreditEntries.reduce((sum, e) => sum + e.amountCents, 0)).toBe(
        customer.storeCreditCents,
      );
    }
  });
});
