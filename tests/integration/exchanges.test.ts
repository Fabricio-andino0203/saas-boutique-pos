import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import {
  ApprovalRequiredError,
  CustomerRequiredError,
  DiscountNeedsApprovalError,
  InsufficientStockError,
  OverReturnError,
  SaleStateError,
  ReturnPolicyError,
  ValidationError,
} from "@/lib/errors";
import { hashSecret } from "@/lib/password";
import type { Role } from "@/lib/permissions";
import { expectedCashCents } from "@/modules/cash/expected";
import { loadCashTotals, openCashSession } from "@/modules/cash/service";
import { findStockDiscrepancies } from "@/modules/inventory/reconcile";
import { recordMovement } from "@/modules/inventory/service";
import { processExchange } from "@/modules/returns/service";
import { getSaleDocument } from "@/modules/sales/queries";
import { completeSale, voidSale } from "@/modules/sales/service";

import { closeDatabase, resetDatabase, testDb } from "./helpers/db";

const closeAll = async () => {
  await db.$disconnect();
  await closeDatabase();
};

type Actor = { id: string; role: Role };

const PINS = { manager: "2222", cashier: "3333" } as const;
let pinHashes: Promise<Record<keyof typeof PINS, string>> | undefined;
function getPinHashes() {
  pinHashes ??= (async () => ({
    manager: await hashSecret(PINS.manager),
    cashier: await hashSecret(PINS.cashier),
  }))();
  return pinHashes;
}

const DAY = 86_400_000;
const MANAGER_PIN = { username: "manager", pin: PINS.manager };

async function world() {
  const hashes = await getPinHashes();
  const make = async (username: string, role: Role, pinHash?: string): Promise<Actor> => {
    const user = await testDb.user.create({
      data: { name: `Nombre ${username}`, username, passwordHash: "x", role, pinHash },
    });
    return { id: user.id, role };
  };
  const owner = await make("owner", "OWNER");
  const manager = await make("manager", "MANAGER", hashes.manager);
  const cashier = await make("cashier", "CASHIER", hashes.cashier);
  const cashier2 = await make("cashier2", "CASHIER");

  const location = await testDb.location.create({
    data: { code: "MAIN", name: "Tienda principal", isDefault: true },
  });
  const terminal = await testDb.terminal.create({
    data: { name: "Caja 1", locationId: location.id },
  });
  const category = await testDb.category.create({ data: { name: "Mujer", slug: "mujer" } });
  const variant = async (code: string, price: number, stock: number) => {
    const product = await testDb.product.create({
      data: { code, name: `Producto ${code}`, categoryId: category.id, basePriceCents: price },
    });
    const created = await testDb.variant.create({
      data: { productId: product.id, sku: code, barcode: `BC-${code}`, avgCostCents: 4000 },
    });
    if (stock > 0) {
      await testDb.$transaction((tx) =>
        recordMovement(tx, {
          variantId: created.id,
          locationId: location.id,
          userId: owner.id,
          type: "INITIAL",
          quantity: stock,
        }),
      );
    }
    return created;
  };
  const dress = await variant("VES1", 11500, 50);
  const dress2 = await variant("VES2", 11500, 50);
  const shirt = await variant("CAM1", 20000, 50);
  const rare = await variant("RAR1", 10000, 0);
  const ana = await testDb.customer.create({ data: { name: "Ana Pérez", phone: "9999-0000" } });
  const shift = await openCashSession(cashier, { openingFloatCents: 50000 }, testDb);
  return {
    owner,
    manager,
    cashier,
    cashier2,
    terminal,
    dress,
    dress2,
    shirt,
    rare,
    ana,
    shiftId: shift.id,
  };
}

type World = Awaited<ReturnType<typeof world>>;

let seq = 0;
const requestId = () => `request-exch-${(seq += 1)}`;

const cash = (amountCents: number) => [{ method: "CASH" as const, amountCents }];

async function sellOne(
  w: World,
  variantId: string,
  price: number,
  withCustomer = true,
  quantity = 1,
) {
  const sale = await completeSale(
    w.cashier,
    {
      clientRequestId: requestId(),
      lines: [{ variantId, quantity }],
      payments: cash(price * quantity),
      ...(withCustomer ? { customerId: w.ana.id } : {}),
    },
    testDb,
  );
  const [item] = await testDb.saleItem.findMany({ where: { saleId: sale.id } });
  return { sale, item: item! };
}

type ExchangeOpts = {
  newLines?: { variantId: string; quantity: number; discount?: { type: "PERCENT"; bps: number } }[];
  payments?: { method: "CASH" | "CARD"; amountCents: number }[];
  refundMethod?: "STORE_CREDIT" | "ORIGINAL" | "CASH";
  customerId?: string;
  managerOverride?: { username: string; pin: string };
  requestId?: string;
  now?: Date;
  quantity?: number;
  condition?: "RESELLABLE" | "DAMAGED";
  invoice?: Record<string, never>;
};

function exchange(
  w: World,
  actor: Actor,
  saleId: string,
  saleItemId: string,
  newVariantId: string,
  opts: ExchangeOpts = {},
) {
  return processExchange(
    actor,
    {
      clientRequestId: opts.requestId ?? requestId(),
      saleId,
      items: [
        { saleItemId, quantity: opts.quantity ?? 1, condition: opts.condition ?? "RESELLABLE" },
      ],
      reason: "Talla incorrecta",
      newLines: opts.newLines ?? [{ variantId: newVariantId, quantity: 1 }],
      payments: opts.payments ?? [],
      ...(opts.refundMethod ? { refundMethod: opts.refundMethod } : {}),
      ...(opts.customerId ? { customerId: opts.customerId } : {}),
      ...(opts.managerOverride ? { managerOverride: opts.managerOverride } : {}),
      ...(opts.invoice ? { invoice: opts.invoice } : {}),
    },
    testDb,
    opts.now,
  );
}

const onHand = async (variantId: string) =>
  (await testDb.stockLevel.findFirst({ where: { variantId } }))?.onHand ?? 0;

async function expectNothingChanged(w: World, before: { sales: number; returns: number }) {
  expect(await testDb.sale.count()).toBe(before.sales);
  expect(await testDb.returnDoc.count()).toBe(before.returns);
  expect(await testDb.storeCreditEntry.count()).toBe(0);
  expect(w.shiftId).toBeTruthy();
}

describe("processExchange: same price", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("swaps one garment for another in a single operation, with no money moving", async () => {
    const w = await world();
    const { sale, item } = await sellOne(w, w.dress.id, 11500);
    const result = await exchange(w, w.cashier, sale.id, item.id, w.dress2.id);

    expect(result).toMatchObject({
      number: "DV-000001",
      refundCents: 0,
      refundMethod: "NONE",
      replayed: false,
      exchange: {
        number: "T-000002",
        totalCents: 11500,
        paidCents: 11500,
        changeCents: 0,
        creditAppliedCents: 11500,
        fiscalNumber: null,
      },
    });

    const doc = await testDb.returnDoc.findUniqueOrThrow({
      where: { id: result.id },
      include: { items: true },
    });
    expect(doc).toMatchObject({
      type: "EXCHANGE",
      saleId: sale.id,
      exchangeSaleId: result.exchange?.id,
      refundMethod: "NONE",
      refundCents: 0,
      processedById: w.cashier.id,
      customerId: w.ana.id,
    });
    expect(doc.items[0]).toMatchObject({
      quantity: 1,
      refundCents: 11500,
      condition: "RESELLABLE",
    });

    // La venta nueva: el valor devuelto como pago "Cambio", a nombre del mismo cliente
    const payments = await testDb.payment.findMany({ where: { saleId: result.exchange!.id } });
    expect(payments.map((p) => [p.method, p.amountCents])).toEqual([["EXCHANGE", 11500]]);
    const newSale = await testDb.sale.findUniqueOrThrow({ where: { id: result.exchange!.id } });
    expect(newSale).toMatchObject({
      customerId: w.ana.id,
      totalCents: 11500,
      paidCents: 11500,
      changeCents: 0,
    });

    // Una entra y la otra sale; el cajón no se mueve
    expect(await onHand(w.dress.id)).toBe(50);
    expect(await onHand(w.dress2.id)).toBe(49);
    const totals = await loadCashTotals(testDb, w.shiftId);
    expect(totals).toMatchObject({
      cashPaymentsCents: 11500,
      changeGivenCents: 0,
      layawayCashCents: 0,
      cashRefundsCents: 0,
    });
    expect(expectedCashCents(totals)).toBe(61500);
    expect(await findStockDiscrepancies(testDb)).toEqual([]);
  });

  it("shows the exchange credit on the new ticket", async () => {
    const w = await world();
    const { sale, item } = await sellOne(w, w.dress.id, 11500);
    const result = await exchange(w, w.cashier, sale.id, item.id, w.dress2.id);
    const doc = await getSaleDocument(result.exchange!.id);
    expect(doc?.payments).toEqual([{ method: "EXCHANGE", amountCents: 11500, reference: null }]);
    expect(doc?.totalCents).toBe(11500);
  });
});

describe("processExchange: the new garment costs more", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("charges just the difference, with change from the cash part", async () => {
    const w = await world();
    const { sale, item } = await sellOne(w, w.dress.id, 11500);
    // Lo nuevo vale 20000; lo devuelto, 11500: faltan 8500 y paga con 10000
    const result = await exchange(w, w.cashier, sale.id, item.id, w.shirt.id, {
      payments: cash(10000),
    });
    expect(result.exchange).toMatchObject({
      totalCents: 20000,
      paidCents: 21500,
      changeCents: 1500,
      creditAppliedCents: 11500,
    });
    expect(result).toMatchObject({ refundCents: 0, refundMethod: "NONE" });
    const payments = await testDb.payment.findMany({
      where: { saleId: result.exchange!.id },
      orderBy: { amountCents: "asc" },
    });
    expect(payments.map((p) => [p.method, p.amountCents])).toEqual([
      ["CASH", 10000],
      ["EXCHANGE", 11500],
    ]);
    // Σ pagos − vuelto = total de la venta nueva
    expect(21500 - 1500).toBe(20000);
    // Al cajón: la venta de 11500 y la diferencia de 10000 con 1500 de vuelto
    const totals = await loadCashTotals(testDb, w.shiftId);
    expect(totals).toMatchObject({ cashPaymentsCents: 21500, changeGivenCents: 1500 });
    expect(expectedCashCents(totals)).toBe(70000);
  });

  it("does nothing at all if the difference is not covered", async () => {
    const w = await world();
    const { sale, item } = await sellOne(w, w.dress.id, 11500);
    const before = { sales: await testDb.sale.count(), returns: await testDb.returnDoc.count() };
    await expect(
      exchange(w, w.cashier, sale.id, item.id, w.shirt.id, { payments: cash(8000) }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expectNothingChanged(w, before);
    expect(await onHand(w.dress.id)).toBe(49);
    expect(await onHand(w.shirt.id)).toBe(50);
    // y los números no se gastaron
    const ok = await exchange(w, w.cashier, sale.id, item.id, w.shirt.id, { payments: cash(8500) });
    expect(ok.number).toBe("DV-000001");
    expect(ok.exchange?.number).toBe("T-000002");
  });
});

describe("processExchange: the new garment costs less", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("gives the leftover back as store credit by default", async () => {
    const w = await world();
    const { sale, item } = await sellOne(w, w.shirt.id, 20000);
    // Lo devuelto vale 20000, lo nuevo 11500: sobran 8500
    const result = await exchange(w, w.cashier, sale.id, item.id, w.dress.id);
    expect(result).toMatchObject({
      refundCents: 8500,
      refundMethod: "STORE_CREDIT",
      exchange: { totalCents: 11500, paidCents: 11500, creditAppliedCents: 11500 },
    });
    const entries = await testDb.storeCreditEntry.findMany({ where: { customerId: w.ana.id } });
    expect(entries.map((e) => [e.amountCents, e.reason, e.refId])).toEqual([
      [8500, "RETURN", result.id],
    ]);
    expect(
      (await testDb.customer.findUniqueOrThrow({ where: { id: w.ana.id } })).storeCreditCents,
    ).toBe(8500);
    const doc = await testDb.returnDoc.findUniqueOrThrow({
      where: { id: result.id },
      include: { items: true },
    });
    // Lo devuelto vale 20000: 11500 se aplicaron a la venta nueva y 8500 se acreditaron
    expect(doc.items.reduce((sum, i) => sum + i.refundCents, 0)).toBe(20000);
    expect(doc.refundCents).toBe(8500);
  });

  it("needs a customer for the credit, and rolls everything back without one", async () => {
    const w = await world();
    const { sale, item } = await sellOne(w, w.shirt.id, 20000, false);
    const before = { sales: await testDb.sale.count(), returns: await testDb.returnDoc.count() };
    await expect(exchange(w, w.cashier, sale.id, item.id, w.dress.id)).rejects.toBeInstanceOf(
      CustomerRequiredError,
    );
    await expectNothingChanged(w, before);
    expect(await onHand(w.dress.id)).toBe(50);
    expect(await onHand(w.shirt.id)).toBe(49);
    // Con el cliente elegido en el momento sí
    const ok = await exchange(w, w.cashier, sale.id, item.id, w.dress.id, { customerId: w.ana.id });
    expect(ok.refundCents).toBe(8500);
    expect(
      (await testDb.sale.findUniqueOrThrow({ where: { id: ok.exchange!.id } })).customerId,
    ).toBe(w.ana.id);
  });

  it("refunds the leftover in cash only with a manager's approval", async () => {
    const w = await world();
    const { sale, item } = await sellOne(w, w.shirt.id, 20000);
    await expect(
      exchange(w, w.cashier, sale.id, item.id, w.dress.id, { refundMethod: "CASH" }),
    ).rejects.toBeInstanceOf(ApprovalRequiredError);
    expect(await testDb.returnDoc.count()).toBe(0);

    const result = await exchange(w, w.cashier, sale.id, item.id, w.dress.id, {
      refundMethod: "CASH",
      managerOverride: MANAGER_PIN,
    });
    expect(result).toMatchObject({ refundCents: 8500, refundMethod: "CASH" });
    expect(
      (await testDb.returnDoc.findUniqueOrThrow({ where: { id: result.id } })).authorizedById,
    ).toBe(w.manager.id);
    const totals = await loadCashTotals(testDb, w.shiftId);
    expect(totals.cashRefundsCents).toBe(8500);
    expect(await testDb.storeCreditEntry.count()).toBe(0);
  });
});

describe("processExchange: all or nothing", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("does not register the return when the new garment is out of stock", async () => {
    const w = await world();
    const { sale, item } = await sellOne(w, w.dress.id, 11500);
    const before = { sales: await testDb.sale.count(), returns: await testDb.returnDoc.count() };
    const error = await exchange(w, w.cashier, sale.id, item.id, w.rare.id).catch((e) => e);
    expect(error).toBeInstanceOf(InsufficientStockError);
    expect((error as InsufficientStockError).variantId).toBe(w.rare.id);
    await expectNothingChanged(w, before);
    expect(await onHand(w.dress.id)).toBe(49); // la devuelta no volvió: todo se revirtió
    // Y los números de ticket y devolución quedan libres
    const ok = await exchange(w, w.cashier, sale.id, item.id, w.dress2.id);
    expect([ok.number, ok.exchange?.number]).toEqual(["DV-000001", "T-000002"]);
  });

  it("keeps a damaged garment out of the shelf but still gives its value to the new one", async () => {
    const w = await world();
    const { sale, item } = await sellOne(w, w.dress.id, 11500);
    const result = await exchange(w, w.cashier, sale.id, item.id, w.dress2.id, {
      condition: "DAMAGED",
    });
    expect(await onHand(w.dress.id)).toBe(49); // entró y salió como merma
    expect(await onHand(w.dress2.id)).toBe(49);
    const movements = await testDb.stockMovement.findMany({
      where: { refType: "ReturnDoc", refId: result.id },
      orderBy: { quantity: "desc" },
    });
    expect(movements.map((m) => [m.type, m.quantity])).toEqual([
      ["RETURN_IN", 1],
      ["RETURN_SCRAP", -1],
    ]);
    expect(await findStockDiscrepancies(testDb)).toEqual([]);
  });

  it("refuses the exchange payment method sent by a client", async () => {
    const w = await world();
    const { sale, item } = await sellOne(w, w.dress.id, 11500);
    await expect(
      processExchange(
        w.cashier,
        {
          clientRequestId: requestId(),
          saleId: sale.id,
          items: [{ saleItemId: item.id, quantity: 1, condition: "RESELLABLE" }],
          reason: "Talla incorrecta",
          newLines: [{ variantId: w.shirt.id, quantity: 1 }],
          payments: [{ method: "EXCHANGE", amountCents: 20000 }],
        },
        testDb,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("processExchange: discounts and the return policy", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("stops a discount over the cashier's limit on what they take, and accepts it with a PIN", async () => {
    const w = await world();
    const { sale, item } = await sellOne(w, w.dress.id, 11500);
    const lines = [
      { variantId: w.shirt.id, quantity: 1, discount: { type: "PERCENT" as const, bps: 2000 } },
    ];
    const before = { sales: await testDb.sale.count(), returns: await testDb.returnDoc.count() };
    await expect(
      exchange(w, w.cashier, sale.id, item.id, w.shirt.id, {
        newLines: lines,
        payments: cash(5000),
      }),
    ).rejects.toBeInstanceOf(DiscountNeedsApprovalError);
    await expectNothingChanged(w, before);

    // 20000 − 20 % = 16000; lo devuelto vale 11500; faltan 4500 y paga con 5000
    const result = await exchange(w, w.cashier, sale.id, item.id, w.shirt.id, {
      newLines: lines,
      payments: cash(5000),
      managerOverride: MANAGER_PIN,
    });
    expect(result.exchange).toMatchObject({
      totalCents: 16000,
      paidCents: 16500,
      changeCents: 500,
    });
    expect(await testDb.auditLog.count({ where: { action: "DISCOUNT_OVERRIDE" } })).toBe(1);
  });

  it("applies the return window to exchanges too", async () => {
    const w = await world();
    const { sale, item } = await sellOne(w, w.dress.id, 11500);
    const created = (await testDb.sale.findUniqueOrThrow({ where: { id: sale.id } })).createdAt;
    const late = new Date(created.getTime() + 20 * DAY);
    await expect(
      exchange(w, w.cashier, sale.id, item.id, w.dress2.id, { now: late }),
    ).rejects.toBeInstanceOf(ReturnPolicyError);
    expect(await testDb.returnDoc.count()).toBe(0);
    const result = await exchange(w, w.cashier, sale.id, item.id, w.dress2.id, {
      now: late,
      managerOverride: MANAGER_PIN,
    });
    expect(
      (await testDb.returnDoc.findUniqueOrThrow({ where: { id: result.id } })).authorizedById,
    ).toBe(w.manager.id);
  });

  it("shares the 'returned at most what was sold' rule with plain returns", async () => {
    const w = await world();
    const { sale, item } = await sellOne(w, w.dress.id, 11500, true, 2);
    await exchange(w, w.cashier, sale.id, item.id, w.dress2.id);
    await expect(
      exchange(w, w.cashier, sale.id, item.id, w.dress2.id, { quantity: 2 }),
    ).rejects.toBeInstanceOf(OverReturnError);
    await expect(exchange(w, w.cashier, sale.id, item.id, w.dress2.id)).resolves.toHaveProperty(
      "id",
    );
    expect(await testDb.returnDoc.count()).toBe(2);
  });
});

describe("processExchange: invoices", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  async function range(w: World) {
    return testDb.fiscalRange.create({
      data: {
        documentType: "INVOICE",
        terminalId: w.terminal.id,
        cai: "ABC123-CAI",
        prefix: "000-001-01-",
        rangeStart: 1,
        rangeEnd: 100,
        nextNumber: 1,
        expiresAt: new Date(Date.now() + 30 * DAY),
      },
    });
  }

  it("issues the invoice of the new sale and gives the number back if the exchange fails", async () => {
    const w = await world();
    const fiscal = await range(w);
    const { sale, item } = await sellOne(w, w.dress.id, 11500);
    await expect(
      exchange(w, w.cashier, sale.id, item.id, w.rare.id, { invoice: {} }),
    ).rejects.toBeInstanceOf(InsufficientStockError);
    expect(
      (await testDb.fiscalRange.findUniqueOrThrow({ where: { id: fiscal.id } })).nextNumber,
    ).toBe(1);

    const ok = await exchange(w, w.cashier, sale.id, item.id, w.dress2.id, { invoice: {} });
    expect(ok.exchange?.fiscalNumber).toBe("000-001-01-00000001");
  });
});

describe("processExchange: corrections", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("does not let the sale born from an exchange be voided: it is corrected with a return", async () => {
    const w = await world();
    const { sale, item } = await sellOne(w, w.dress.id, 11500);
    const result = await exchange(w, w.cashier, sale.id, item.id, w.dress2.id);
    await expect(
      voidSale(w.manager, result.exchange!.id, { reason: "Error del cajero" }, testDb),
    ).rejects.toBeInstanceOf(SaleStateError);
    expect(
      (await testDb.sale.findUniqueOrThrow({ where: { id: result.exchange!.id } })).status,
    ).toBe("COMPLETED");
    expect(await onHand(w.dress2.id)).toBe(49);
  });
});

describe("processExchange: idempotency and the books", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("returns the same exchange when the same request is sent again", async () => {
    const w = await world();
    const { sale, item } = await sellOne(w, w.dress.id, 11500);
    const id = requestId();
    const first = await exchange(w, w.cashier, sale.id, item.id, w.dress2.id, { requestId: id });
    const again = await exchange(w, w.cashier, sale.id, item.id, w.dress2.id, { requestId: id });
    expect(first.replayed).toBe(false);
    expect(again).toEqual({ ...first, replayed: true });
    expect(await testDb.returnDoc.count()).toBe(1);
    expect(await testDb.sale.count()).toBe(2);
    expect(await onHand(w.dress2.id)).toBe(49);
  });

  it("does not exchange twice when the button is pressed several times at once", async () => {
    const w = await world();
    const { sale, item } = await sellOne(w, w.dress.id, 11500);
    const id = requestId();
    const results = await Promise.all(
      [1, 2, 3].map(() => exchange(w, w.cashier, sale.id, item.id, w.dress2.id, { requestId: id })),
    );
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(await testDb.returnDoc.count()).toBe(1);
    expect(await testDb.sale.count()).toBe(2);
    expect(await onHand(w.dress2.id)).toBe(49);
  });

  it("keeps every sale balanced, the credit equal to its ledger and the stock reconciled", async () => {
    const w = await world();
    for (let round = 0; round < 4; round += 1) {
      const { sale, item } = await sellOne(
        w,
        round % 2 === 0 ? w.shirt.id : w.dress.id,
        round % 2 === 0 ? 20000 : 11500,
      );
      await exchange(w, w.cashier, sale.id, item.id, round % 2 === 0 ? w.dress2.id : w.shirt.id, {
        payments: round % 2 === 0 ? [] : cash(8500),
      });
    }
    for (const sale of await testDb.sale.findMany({ include: { payments: true, items: true } })) {
      expect(sale.payments.reduce((sum, p) => sum + p.amountCents, 0) - sale.changeCents).toBe(
        sale.totalCents,
      );
      expect(sale.items.reduce((sum, i) => sum + i.lineTotalCents, 0)).toBe(sale.totalCents);
    }
    for (const customer of await testDb.customer.findMany({
      include: { storeCreditEntries: true },
    })) {
      expect(customer.storeCreditEntries.reduce((sum, e) => sum + e.amountCents, 0)).toBe(
        customer.storeCreditCents,
      );
    }
    for (const item of await testDb.saleItem.findMany({ include: { returnItems: true } })) {
      expect(item.returnItems.reduce((sum, r) => sum + r.quantity, 0)).toBeLessThanOrEqual(
        item.quantity,
      );
    }
    expect(await findStockDiscrepancies(testDb)).toEqual([]);
  });
});
