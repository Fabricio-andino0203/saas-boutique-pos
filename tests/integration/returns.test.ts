import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import {
  ApprovalRequiredError,
  CashSessionClosedError,
  ConflictError,
  CustomerRequiredError,
  ForbiddenError,
  InsufficientCashError,
  InvalidCredentialsError,
  NotFoundError,
  OverReturnError,
  ReturnPolicyError,
  SaleStateError,
  ValidationError,
} from "@/lib/errors";
import { hashSecret } from "@/lib/password";
import type { Role } from "@/lib/permissions";
import { setSetting } from "@/lib/settings";
import { expectedCashCents } from "@/modules/cash/expected";
import { loadCashTotals, openCashSession, submitCashClose } from "@/modules/cash/service";
import { getKardex } from "@/modules/inventory/queries";
import { findStockDiscrepancies } from "@/modules/inventory/reconcile";
import { recordMovement } from "@/modules/inventory/service";
import {
  getReturnableSale,
  getReturnDocument,
  listReturnsOfSale,
  searchSalesForReturn,
} from "@/modules/returns/queries";
import { processReturn } from "@/modules/returns/service";
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
  const warehouse = await make("warehouse", "WAREHOUSE");

  const location = await testDb.location.create({
    data: { code: "MAIN", name: "Tienda principal", isDefault: true },
  });
  const terminal = await testDb.terminal.create({
    data: { name: "Caja 1", locationId: location.id },
  });
  const women = await testDb.category.create({ data: { name: "Mujer", slug: "mujer" } });
  const underwear = await testDb.category.create({
    data: { name: "Ropa interior", slug: "ropa-interior", allowsReturns: false },
  });
  const bras = await testDb.category.create({
    data: { name: "Brasieres", slug: "brasieres", parentId: underwear.id },
  });

  const product = (code: string, name: string, price: number, categoryId: string) =>
    testDb.product.create({ data: { code, name, categoryId, basePriceCents: price } });
  const variant = (productId: string, sku: string, barcode: string) =>
    testDb.variant.create({ data: { productId, sku, barcode, avgCostCents: 4000 } });
  const stock = (variantId: string, quantity: number) =>
    testDb.$transaction((tx) =>
      recordMovement(tx, {
        variantId,
        locationId: location.id,
        userId: owner.id,
        type: "INITIAL",
        quantity,
      }),
    );

  const dress = await variant(
    (await product("VES1", "Vestido", 11500, women.id)).id,
    "VES1",
    "7001",
  );
  const shirt = await variant(
    (await product("CAM1", "Camisa", 20000, women.id)).id,
    "CAM1",
    "7002",
  );
  const piece = await variant((await product("PZA1", "Pieza", 3333, women.id)).id, "PZA1", "7003");
  const bra1 = await variant(
    (await product("INT1", "Ropa interior", 5000, underwear.id)).id,
    "INT1",
    "7004",
  );
  const bra2 = await variant((await product("BRA1", "Brasier", 6000, bras.id)).id, "BRA1", "7005");
  for (const v of [dress, shirt, piece, bra1, bra2]) {
    await stock(v.id, 50);
  }
  const ana = await testDb.customer.create({ data: { name: "Ana Pérez", phone: "9999-0000" } });
  const bea = await testDb.customer.create({ data: { name: "Bea López", phone: "8888-1111" } });
  const shift = await openCashSession(cashier, { openingFloatCents: 50000 }, testDb);
  return {
    owner,
    manager,
    cashier,
    cashier2,
    warehouse,
    terminal,
    dress,
    shirt,
    piece,
    bra1,
    bra2,
    ana,
    bea,
    shiftId: shift.id,
  };
}

type World = Awaited<ReturnType<typeof world>>;

let requestSeq = 0;
const requestId = () => `request-ret-${(requestSeq += 1)}`;

function sell(
  w: World,
  actor: Actor,
  lines: { variantId: string; quantity: number }[],
  payments: { method: "CASH" | "CARD"; amountCents: number }[],
  extra: Record<string, unknown> = {},
) {
  return completeSale(actor, { clientRequestId: requestId(), lines, payments, ...extra }, testDb);
}

const cash = (amountCents: number) => [{ method: "CASH" as const, amountCents }];
const card = (amountCents: number) => [{ method: "CARD" as const, amountCents }];

const itemsOf = (saleId: string) =>
  testDb.saleItem.findMany({ where: { saleId }, orderBy: { id: "asc" } });

type ReturnOpts = {
  method?: "STORE_CREDIT" | "ORIGINAL" | "CASH";
  customerId?: string;
  managerOverride?: { username: string; pin: string };
  reason?: string;
  requestId?: string;
  now?: Date;
};

async function giveBack(
  actor: Actor,
  saleId: string,
  lines: { saleItemId: string; quantity: number; condition?: "RESELLABLE" | "DAMAGED" }[],
  opts: ReturnOpts = {},
) {
  return processReturn(
    actor,
    {
      clientRequestId: opts.requestId ?? requestId(),
      saleId,
      items: lines.map((line) => ({ condition: "RESELLABLE", ...line })),
      reason: opts.reason ?? "Talla incorrecta",
      refundMethod: opts.method ?? "STORE_CREDIT",
      ...(opts.customerId ? { customerId: opts.customerId } : {}),
      ...(opts.managerOverride ? { managerOverride: opts.managerOverride } : {}),
    },
    testDb,
    opts.now,
  );
}

const onHand = async (variantId: string) =>
  (await testDb.stockLevel.findFirst({ where: { variantId } }))?.onHand ?? 0;

const MANAGER_PIN = { username: "manager", pin: PINS.manager };

describe("processReturn: a normal return to store credit", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("puts the garment back, credits the customer and leaves a trace", async () => {
    const w = await world();
    const sale = await sell(w, w.cashier, [{ variantId: w.dress.id, quantity: 2 }], cash(23000), {
      customerId: w.ana.id,
    });
    const [item] = await itemsOf(sale.id);
    expect(await onHand(w.dress.id)).toBe(48);

    const result = await giveBack(w.cashier, sale.id, [{ saleItemId: item!.id, quantity: 1 }]);
    // 23000 entre 2 unidades: [11500, 11500]
    expect(result).toMatchObject({
      number: "DV-000001",
      refundCents: 11500,
      refundMethod: "STORE_CREDIT",
      replayed: false,
    });

    const doc = await testDb.returnDoc.findUniqueOrThrow({
      where: { id: result.id },
      include: { items: true },
    });
    expect(doc).toMatchObject({
      saleId: sale.id,
      type: "RETURN",
      reason: "Talla incorrecta",
      refundMethod: "STORE_CREDIT",
      refundCents: 11500,
      customerId: w.ana.id,
      cashSessionId: w.shiftId,
      processedById: w.cashier.id,
      authorizedById: null,
      exchangeSaleId: null,
    });
    expect(doc.items).toHaveLength(1);
    expect(doc.items[0]).toMatchObject({
      saleItemId: item!.id,
      quantity: 1,
      condition: "RESELLABLE",
      refundCents: 11500,
    });

    // Vuelve a la estantería, con el costo de cuando se vendió
    expect(await onHand(w.dress.id)).toBe(49);
    const back = await testDb.stockMovement.findFirstOrThrow({ where: { type: "RETURN_IN" } });
    expect(back).toMatchObject({
      quantity: 1,
      unitCostCents: 4000,
      refType: "ReturnDoc",
      refId: doc.id,
      userId: w.cashier.id,
    });

    // Crédito de tienda: libro y saldo
    const entries = await testDb.storeCreditEntry.findMany({ where: { customerId: w.ana.id } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      amountCents: 11500,
      reason: "RETURN",
      refType: "ReturnDoc",
      refId: doc.id,
      userId: w.cashier.id,
    });
    expect(
      (await testDb.customer.findUniqueOrThrow({ where: { id: w.ana.id } })).storeCreditCents,
    ).toBe(11500);

    const log = await testDb.auditLog.findFirstOrThrow({ where: { action: "RETURN_PROCESSED" } });
    expect(log).toMatchObject({ userId: w.cashier.id, entityType: "ReturnDoc", entityId: doc.id });
    expect(log.after).toEqual({
      number: "DV-000001",
      saleId: sale.id,
      type: "RETURN",
      valueCents: 11500,
      refundCents: 11500,
      refundMethod: "STORE_CREDIT",
      units: 1,
    });
    expect(await testDb.auditLog.count({ where: { action: "RETURN_OVERRIDE" } })).toBe(0);
    expect(await findStockDiscrepancies(testDb)).toEqual([]);
  });

  it("numbers the returns one after another and links each to its kardex movement", async () => {
    const w = await world();
    const sale = await sell(w, w.cashier, [{ variantId: w.dress.id, quantity: 2 }], cash(23000), {
      customerId: w.ana.id,
    });
    const [item] = await itemsOf(sale.id);
    const a = await giveBack(w.cashier, sale.id, [{ saleItemId: item!.id, quantity: 1 }]);
    const b = await giveBack(w.cashier, sale.id, [{ saleItemId: item!.id, quantity: 1 }]);
    expect([a.number, b.number]).toEqual(["DV-000001", "DV-000002"]);
    const kardex = await getKardex(w.dress.id, {}, testDb);
    const row = kardex?.rows.find(
      (r) => r.type === "RETURN_IN" && r.document?.label === "DV-000001",
    );
    expect(row?.document).toEqual({ label: "DV-000001", href: `/imprimir/devolucion/${a.id}` });
  });
});

describe("processReturn: the refund is exactly what was paid", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("splits an indivisible line unit by unit and never refunds a cent more than was paid", async () => {
    const w = await world();
    // 3 × 3333 = 9999 con L 1.00 de descuento global: la línea pagó 9899 → [3300, 3300, 3299]
    const sale = await sell(w, w.manager, [{ variantId: w.piece.id, quantity: 3 }], cash(9899), {
      discount: { type: "AMOUNT", cents: 100 },
      customerId: w.ana.id,
    });
    const [item] = await itemsOf(sale.id);
    expect(item?.lineTotalCents).toBe(9899);

    const refunds: number[] = [];
    for (let unit = 0; unit < 3; unit += 1) {
      const result = await giveBack(w.cashier, sale.id, [{ saleItemId: item!.id, quantity: 1 }]);
      refunds.push(result.refundCents);
    }
    expect(refunds).toEqual([3300, 3300, 3299]);
    expect(refunds.reduce((sum, value) => sum + value, 0)).toBe(sale.totalCents);
    // Y no se puede devolver una cuarta
    await expect(
      giveBack(w.cashier, sale.id, [{ saleItemId: item!.id, quantity: 1 }]),
    ).rejects.toBeInstanceOf(OverReturnError);
  });

  it("gives back each garment its own share of a global discount", async () => {
    const w = await world();
    // 11500 + 20000 = 31500; 10 % global = 3150 → [1150, 2000]; pagaron 10350 y 18000 (suma 28350)
    const sale = await sell(
      w,
      w.manager,
      [
        { variantId: w.dress.id, quantity: 1 },
        { variantId: w.shirt.id, quantity: 1 },
      ],
      cash(28350),
      { discount: { type: "PERCENT", bps: 1000 }, customerId: w.ana.id },
    );
    const items = await itemsOf(sale.id);
    const dressItem = items.find((i) => i.sku === "VES1");
    const shirtItem = items.find((i) => i.sku === "CAM1");
    const first = await giveBack(w.cashier, sale.id, [{ saleItemId: dressItem!.id, quantity: 1 }]);
    const second = await giveBack(w.cashier, sale.id, [{ saleItemId: shirtItem!.id, quantity: 1 }]);
    expect([first.refundCents, second.refundCents]).toEqual([10350, 18000]);
    expect(first.refundCents + second.refundCents).toBe(sale.totalCents);
  });

  it("never returns more than was sold, in one go or across several returns", async () => {
    const w = await world();
    const sale = await sell(w, w.cashier, [{ variantId: w.dress.id, quantity: 2 }], cash(23000), {
      customerId: w.ana.id,
    });
    const [item] = await itemsOf(sale.id);
    await expect(
      giveBack(w.cashier, sale.id, [{ saleItemId: item!.id, quantity: 3 }]),
    ).rejects.toBeInstanceOf(OverReturnError);
    await giveBack(w.cashier, sale.id, [{ saleItemId: item!.id, quantity: 1 }]);
    await expect(
      giveBack(w.cashier, sale.id, [{ saleItemId: item!.id, quantity: 2 }]),
    ).rejects.toBeInstanceOf(OverReturnError);
    expect(await onHand(w.dress.id)).toBe(49);
    expect(await testDb.returnDoc.count()).toBe(1);
  });
});

describe("processReturn: damaged garments", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("comes in and goes straight out as scrap, so the shelf does not grow", async () => {
    const w = await world();
    const sale = await sell(w, w.cashier, [{ variantId: w.dress.id, quantity: 2 }], cash(23000), {
      customerId: w.ana.id,
    });
    const [item] = await itemsOf(sale.id);
    const result = await giveBack(w.cashier, sale.id, [
      { saleItemId: item!.id, quantity: 1, condition: "DAMAGED" },
    ]);
    // El cliente recibe su dinero igual; la prenda no vuelve a estar disponible
    expect(result.refundCents).toBe(11500);
    expect(await onHand(w.dress.id)).toBe(48);
    const movements = await testDb.stockMovement.findMany({
      where: { refType: "ReturnDoc", refId: result.id },
      orderBy: { quantity: "desc" },
    });
    expect(movements.map((m) => [m.type, m.quantity, m.unitCostCents])).toEqual([
      ["RETURN_IN", 1, 4000],
      ["RETURN_SCRAP", -1, 4000],
    ]);
    const returned = await testDb.returnItem.findFirstOrThrow({ where: { returnId: result.id } });
    expect(returned.condition).toBe("DAMAGED");
    expect(await findStockDiscrepancies(testDb)).toEqual([]);
  });
});

describe("processReturn: how the money goes back", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("needs a manager to refund cash, and takes it out of the drawer when approved", async () => {
    const w = await world();
    const sale = await sell(w, w.cashier, [{ variantId: w.dress.id, quantity: 2 }], cash(23000));
    const [item] = await itemsOf(sale.id);
    const before = expectedCashCents(await loadCashTotals(testDb, w.shiftId));
    expect(before).toBe(73000); // 50000 de fondo + 23000 cobrados en efectivo

    // Sin autorización no sale dinero
    await expect(
      giveBack(w.cashier, sale.id, [{ saleItemId: item!.id, quantity: 1 }], { method: "CASH" }),
    ).rejects.toBeInstanceOf(ApprovalRequiredError);
    expect(await testDb.returnDoc.count()).toBe(0);
    expect(await onHand(w.dress.id)).toBe(48);

    // Con el PIN de un gerente sí; queda quién autorizó
    const result = await giveBack(w.cashier, sale.id, [{ saleItemId: item!.id, quantity: 1 }], {
      method: "CASH",
      managerOverride: MANAGER_PIN,
    });
    expect(result).toMatchObject({ refundCents: 11500, refundMethod: "CASH" });
    const doc = await testDb.returnDoc.findUniqueOrThrow({ where: { id: result.id } });
    expect(doc.authorizedById).toBe(w.manager.id);

    const totals = await loadCashTotals(testDb, w.shiftId);
    expect(totals.cashRefundsCents).toBe(11500);
    expect(expectedCashCents(totals)).toBe(61500); // 73000 − 11500
    const log = await testDb.auditLog.findFirstOrThrow({ where: { action: "RETURN_OVERRIDE" } });
    expect(log.userId).toBe(w.cashier.id);
    expect(log.after).toEqual({
      outsidePolicy: false,
      cashRefund: true,
      authorizedById: w.manager.id,
    });
    // No hay crédito de tienda: el dinero salió en efectivo
    expect(await testDb.storeCreditEntry.count()).toBe(0);
  });

  it("lets a manager refund cash without a PIN and still leaves the trace", async () => {
    const w = await world();
    const sale = await sell(w, w.cashier, [{ variantId: w.dress.id, quantity: 1 }], cash(11500));
    const [item] = await itemsOf(sale.id);
    const result = await giveBack(w.manager, sale.id, [{ saleItemId: item!.id, quantity: 1 }], {
      method: "CASH",
    });
    const doc = await testDb.returnDoc.findUniqueOrThrow({ where: { id: result.id } });
    expect(doc).toMatchObject({ processedById: w.manager.id, authorizedById: null });
    const log = await testDb.auditLog.findFirstOrThrow({ where: { action: "RETURN_OVERRIDE" } });
    expect(log.after).toMatchObject({ cashRefund: true, authorizedById: w.manager.id });
  });

  it("refuses a cash refund bigger than what is in the drawer", async () => {
    const w = await world();
    // 6 × 11500 = 69000 pagados con tarjeta: en el cajón solo están los 50000 del fondo
    const sale = await sell(w, w.cashier, [{ variantId: w.dress.id, quantity: 6 }], card(69000));
    const [item] = await itemsOf(sale.id);
    await expect(
      giveBack(w.manager, sale.id, [{ saleItemId: item!.id, quantity: 6 }], { method: "CASH" }),
    ).rejects.toBeInstanceOf(InsufficientCashError);
    expect(await testDb.returnDoc.count()).toBe(0);
    expect(await onHand(w.dress.id)).toBe(44);
    // Una parte menor sí cabe
    await expect(
      giveBack(w.manager, sale.id, [{ saleItemId: item!.id, quantity: 2 }], { method: "CASH" }),
    ).resolves.toMatchObject({ refundCents: 23000 });
  });

  it("refuses a wrong PIN and the PIN of someone who is not a manager", async () => {
    const w = await world();
    const sale = await sell(w, w.cashier, [{ variantId: w.dress.id, quantity: 1 }], cash(11500));
    const [item] = await itemsOf(sale.id);
    const lines = [{ saleItemId: item!.id, quantity: 1 }];
    await expect(
      giveBack(w.cashier, sale.id, lines, {
        method: "CASH",
        managerOverride: { username: "manager", pin: "9999" },
      }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    await expect(
      giveBack(w.cashier, sale.id, lines, {
        method: "CASH",
        managerOverride: { username: "cashier", pin: PINS.cashier },
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await testDb.returnDoc.count()).toBe(0);
  });

  it("refunds to the original method only when it was paid by card or transfer", async () => {
    const w = await world();
    const byCard = await sell(w, w.cashier, [{ variantId: w.dress.id, quantity: 1 }], card(11500));
    const [cardItem] = await itemsOf(byCard.id);
    const refund = await giveBack(
      w.cashier,
      byCard.id,
      [{ saleItemId: cardItem!.id, quantity: 1 }],
      {
        method: "ORIGINAL",
      },
    );
    expect(refund).toMatchObject({ refundMethod: "ORIGINAL", refundCents: 11500 });
    // No toca el cajón ni el crédito de tienda
    expect((await loadCashTotals(testDb, w.shiftId)).cashRefundsCents).toBe(0);
    expect(await testDb.storeCreditEntry.count()).toBe(0);

    const byCash = await sell(w, w.cashier, [{ variantId: w.dress.id, quantity: 1 }], cash(11500));
    const [cashItem] = await itemsOf(byCash.id);
    await expect(
      giveBack(w.cashier, byCash.id, [{ saleItemId: cashItem!.id, quantity: 1 }], {
        method: "ORIGINAL",
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    const mixed = await sell(
      w,
      w.cashier,
      [{ variantId: w.dress.id, quantity: 1 }],
      [
        { method: "CARD", amountCents: 5000 },
        { method: "CASH", amountCents: 6500 },
      ],
    );
    const [mixedItem] = await itemsOf(mixed.id);
    await expect(
      giveBack(w.cashier, mixed.id, [{ saleItemId: mixedItem!.id, quantity: 1 }], {
        method: "ORIGINAL",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("needs a customer for store credit, and credits the one chosen at the counter", async () => {
    const w = await world();
    const sale = await sell(w, w.cashier, [{ variantId: w.dress.id, quantity: 1 }], cash(11500));
    const [item] = await itemsOf(sale.id);
    const lines = [{ saleItemId: item!.id, quantity: 1 }];
    await expect(giveBack(w.cashier, sale.id, lines)).rejects.toBeInstanceOf(CustomerRequiredError);
    await expect(
      giveBack(w.cashier, sale.id, lines, { customerId: "no-existe" }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await testDb.returnDoc.count()).toBe(0);

    const result = await giveBack(w.cashier, sale.id, lines, { customerId: w.bea.id });
    const doc = await testDb.returnDoc.findUniqueOrThrow({ where: { id: result.id } });
    expect(doc.customerId).toBe(w.bea.id);
    expect(
      (await testDb.customer.findUniqueOrThrow({ where: { id: w.bea.id } })).storeCreditCents,
    ).toBe(11500);
  });
});

describe("processReturn: the return policy", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  async function oneDress(w: World) {
    const sale = await sell(w, w.cashier, [{ variantId: w.dress.id, quantity: 1 }], cash(11500), {
      customerId: w.ana.id,
    });
    const [item] = await itemsOf(sale.id);
    const created = (await testDb.sale.findUniqueOrThrow({ where: { id: sale.id } })).createdAt;
    return { sale, lines: [{ saleItemId: item!.id, quantity: 1 }], created };
  }

  it("accepts a return up to the last day of the window and stops the day after", async () => {
    const w = await world();
    const { sale, lines, created } = await oneDress(w);
    const day9 = new Date(created.getTime() + 9 * DAY);
    await expect(giveBack(w.cashier, sale.id, lines, { now: day9 })).rejects.toBeInstanceOf(
      ReturnPolicyError,
    );
    // 8 días: todavía dentro del plazo
    const day8 = new Date(created.getTime() + 8 * DAY);
    await expect(giveBack(w.cashier, sale.id, lines, { now: day8 })).resolves.toHaveProperty("id");
  });

  it("follows the number of days in the settings", async () => {
    const w = await world();
    await setSetting(testDb, "returns.maxDays", 0);
    const { sale, lines, created } = await oneDress(w);
    await expect(
      giveBack(w.cashier, sale.id, lines, { now: new Date(created.getTime() + DAY) }),
    ).rejects.toBeInstanceOf(ReturnPolicyError);
    await expect(giveBack(w.cashier, sale.id, lines, { now: created })).resolves.toHaveProperty(
      "id",
    );
  });

  it("lets a manager's PIN authorize a late return and records the exception", async () => {
    const w = await world();
    const { sale, lines, created } = await oneDress(w);
    const late = new Date(created.getTime() + 20 * DAY);
    const result = await giveBack(w.cashier, sale.id, lines, {
      now: late,
      managerOverride: MANAGER_PIN,
    });
    const doc = await testDb.returnDoc.findUniqueOrThrow({ where: { id: result.id } });
    expect(doc.authorizedById).toBe(w.manager.id);
    const log = await testDb.auditLog.findFirstOrThrow({ where: { action: "RETURN_OVERRIDE" } });
    expect(log.after).toEqual({
      outsidePolicy: true,
      cashRefund: false,
      authorizedById: w.manager.id,
    });
  });

  it("lets a manager make a late return without a PIN, still leaving the trace", async () => {
    const w = await world();
    const { sale, lines, created } = await oneDress(w);
    const late = new Date(created.getTime() + 20 * DAY);
    const result = await giveBack(w.manager, sale.id, lines, { now: late });
    expect(
      (await testDb.returnDoc.findUniqueOrThrow({ where: { id: result.id } })).authorizedById,
    ).toBeNull();
    const log = await testDb.auditLog.findFirstOrThrow({ where: { action: "RETURN_OVERRIDE" } });
    expect(log.after).toMatchObject({ outsidePolicy: true, authorizedById: w.manager.id });
  });

  it("blocks categories that do not admit returns, including their subcategories", async () => {
    const w = await world();
    let made = 0;
    for (const variant of [w.bra1, w.bra2]) {
      const sale = await sell(w, w.cashier, [{ variantId: variant.id, quantity: 1 }], cash(10000), {
        customerId: w.ana.id,
      });
      const [item] = await itemsOf(sale.id);
      const lines = [{ saleItemId: item!.id, quantity: 1 }];
      await expect(giveBack(w.cashier, sale.id, lines)).rejects.toBeInstanceOf(ReturnPolicyError);
      expect(await testDb.returnDoc.count()).toBe(made);
      await expect(
        giveBack(w.cashier, sale.id, lines, { managerOverride: MANAGER_PIN }),
      ).resolves.toHaveProperty("id");
      made += 1;
    }
  });

  it("blocks a mixed return if just one garment is of a blocked category", async () => {
    const w = await world();
    const sale = await sell(
      w,
      w.cashier,
      [
        { variantId: w.dress.id, quantity: 1 },
        { variantId: w.bra1.id, quantity: 1 },
      ],
      cash(16500),
      { customerId: w.ana.id },
    );
    const items = await itemsOf(sale.id);
    await expect(
      giveBack(
        w.cashier,
        sale.id,
        items.map((i) => ({ saleItemId: i.id, quantity: 1 })),
      ),
    ).rejects.toBeInstanceOf(ReturnPolicyError);
    // Solo el vestido sí se puede
    const dressItem = items.find((i) => i.sku === "VES1");
    await expect(
      giveBack(w.cashier, sale.id, [{ saleItemId: dressItem!.id, quantity: 1 }]),
    ).resolves.toHaveProperty("id");
  });
});

describe("processReturn: refusals", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("refuses roles that cannot return, bad input and lines from another sale", async () => {
    const w = await world();
    const sale = await sell(w, w.cashier, [{ variantId: w.dress.id, quantity: 1 }], cash(11500), {
      customerId: w.ana.id,
    });
    const other = await sell(w, w.cashier, [{ variantId: w.shirt.id, quantity: 1 }], cash(20000));
    const [item] = await itemsOf(sale.id);
    const [otherItem] = await itemsOf(other.id);
    const line = { saleItemId: item!.id, quantity: 1 };

    await expect(giveBack(w.warehouse, sale.id, [line])).rejects.toBeInstanceOf(ForbiddenError);
    await expect(giveBack(w.cashier, sale.id, [line], { reason: "ab" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      giveBack(w.cashier, sale.id, [{ saleItemId: item!.id, quantity: 0 }]),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(giveBack(w.cashier, sale.id, [line, line])).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      giveBack(w.cashier, sale.id, [{ saleItemId: otherItem!.id, quantity: 1 }]),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(giveBack(w.cashier, "no-existe", [line])).rejects.toBeInstanceOf(NotFoundError);
    expect(await testDb.returnDoc.count()).toBe(0);
  });

  it("refuses to return a voided sale", async () => {
    const w = await world();
    const sale = await sell(w, w.cashier, [{ variantId: w.dress.id, quantity: 1 }], cash(11500), {
      customerId: w.ana.id,
    });
    const [item] = await itemsOf(sale.id);
    await voidSale(w.manager, sale.id, { reason: "Se equivocó de talla" }, testDb);
    await expect(
      giveBack(w.cashier, sale.id, [{ saleItemId: item!.id, quantity: 1 }]),
    ).rejects.toBeInstanceOf(SaleStateError);
  });

  it("needs an open shift: the refund comes out of a shift", async () => {
    const w = await world();
    const sale = await sell(w, w.cashier, [{ variantId: w.dress.id, quantity: 1 }], cash(11500), {
      customerId: w.ana.id,
    });
    const [item] = await itemsOf(sale.id);
    await submitCashClose(w.cashier, { countedCashCents: 61500 }, testDb);
    await expect(
      giveBack(w.cashier, sale.id, [{ saleItemId: item!.id, quantity: 1 }]),
    ).rejects.toBeInstanceOf(CashSessionClosedError);
    expect(await onHand(w.dress.id)).toBe(49);
  });

  it("books the refund in the open shift even when the sale belongs to an earlier one", async () => {
    const w = await world();
    const sale = await sell(w, w.cashier, [{ variantId: w.dress.id, quantity: 1 }], cash(11500), {
      customerId: w.ana.id,
    });
    const [item] = await itemsOf(sale.id);
    await submitCashClose(w.cashier, { countedCashCents: 61500 }, testDb);
    // El cierre anterior dejó L 615.00 en el cajón: abrir con otro fondo pide el comentario.
    const next = await openCashSession(
      w.cashier,
      { openingFloatCents: 20000, openingNotes: "Fondo de la prueba" },
      testDb,
    );
    const result = await giveBack(w.cashier, sale.id, [{ saleItemId: item!.id, quantity: 1 }]);
    const doc = await testDb.returnDoc.findUniqueOrThrow({ where: { id: result.id } });
    expect(doc.cashSessionId).toBe(next.id);
  });

  it("does not let a sale with returns be voided", async () => {
    const w = await world();
    const sale = await sell(w, w.cashier, [{ variantId: w.dress.id, quantity: 2 }], cash(23000), {
      customerId: w.ana.id,
    });
    const [item] = await itemsOf(sale.id);
    await giveBack(w.cashier, sale.id, [{ saleItemId: item!.id, quantity: 1 }]);
    await expect(
      voidSale(w.manager, sale.id, { reason: "Ya no la quiere" }, testDb),
    ).rejects.toBeInstanceOf(SaleStateError);
    expect((await testDb.sale.findUniqueOrThrow({ where: { id: sale.id } })).status).toBe(
      "COMPLETED",
    );
  });
});

describe("processReturn: idempotency and concurrency", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  async function oneSale(w: World, quantity = 2) {
    const sale = await sell(
      w,
      w.cashier,
      [{ variantId: w.dress.id, quantity }],
      cash(11500 * quantity),
      {
        customerId: w.ana.id,
      },
    );
    const [item] = await itemsOf(sale.id);
    return { sale, item: item! };
  }

  it("returns the same document when the same request is sent again", async () => {
    const w = await world();
    const { sale, item } = await oneSale(w);
    const id = requestId();
    const first = await giveBack(w.cashier, sale.id, [{ saleItemId: item.id, quantity: 1 }], {
      requestId: id,
    });
    const again = await giveBack(w.cashier, sale.id, [{ saleItemId: item.id, quantity: 1 }], {
      requestId: id,
    });
    expect(first.replayed).toBe(false);
    expect(again).toEqual({ ...first, replayed: true });
    expect(await testDb.returnDoc.count()).toBe(1);
    expect(await onHand(w.dress.id)).toBe(49);
    expect(await testDb.storeCreditEntry.count()).toBe(1);
  });

  it("does not return twice when the button is pressed several times at once", async () => {
    const w = await world();
    const { sale, item } = await oneSale(w);
    const id = requestId();
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        giveBack(w.cashier, sale.id, [{ saleItemId: item.id, quantity: 1 }], { requestId: id }),
      ),
    );
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(await testDb.returnDoc.count()).toBe(1);
    expect(await onHand(w.dress.id)).toBe(49);
    expect(
      (await testDb.customer.findUniqueOrThrow({ where: { id: w.ana.id } })).storeCreditCents,
    ).toBe(11500);
  });

  it("does not hand someone else's return back to another person", async () => {
    const w = await world();
    const { sale, item } = await oneSale(w);
    const id = requestId();
    await giveBack(w.cashier, sale.id, [{ saleItemId: item.id, quantity: 1 }], { requestId: id });
    await expect(
      giveBack(w.cashier2, sale.id, [{ saleItemId: item.id, quantity: 1 }], { requestId: id }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("lets only one of two simultaneous returns take the last unit", async () => {
    const w = await world();
    const { sale, item } = await oneSale(w, 1);
    const results = await Promise.allSettled([
      giveBack(w.cashier, sale.id, [{ saleItemId: item.id, quantity: 1 }]),
      giveBack(w.cashier2, sale.id, [{ saleItemId: item.id, quantity: 1 }]),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason).toBeInstanceOf(OverReturnError);
    expect(await testDb.returnDoc.count()).toBe(1);
    expect(await onHand(w.dress.id)).toBe(50);
  });
});

describe("return queries", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("finds sales by ticket number, customer name or phone, and leaves voided ones out", async () => {
    const w = await world();
    const a = await sell(w, w.cashier, [{ variantId: w.dress.id, quantity: 1 }], cash(11500), {
      customerId: w.ana.id,
    });
    const b = await sell(w, w.cashier, [{ variantId: w.shirt.id, quantity: 1 }], cash(20000), {
      customerId: w.bea.id,
    });
    const gone = await sell(w, w.cashier, [{ variantId: w.piece.id, quantity: 1 }], cash(3333));
    await voidSale(w.manager, gone.id, { reason: "Error de cobro" }, testDb);

    expect((await searchSalesForReturn("")).map((r) => r.number)).toEqual([b.number, a.number]);
    expect((await searchSalesForReturn(a.number)).map((r) => r.id)).toEqual([a.id]);
    expect((await searchSalesForReturn("bea")).map((r) => r.id)).toEqual([b.id]);
    expect((await searchSalesForReturn("9999")).map((r) => r.id)).toEqual([a.id]);
    expect(await searchSalesForReturn("nadie")).toEqual([]);
    const [row] = await searchSalesForReturn(b.number);
    expect(row).toMatchObject({
      customerName: "Bea López",
      totalCents: 20000,
      daysSince: 0,
      units: 1,
      returnedUnits: 0,
    });
  });

  it("shows what can still be returned and what the policy says", async () => {
    const w = await world();
    const sale = await sell(
      w,
      w.cashier,
      [
        { variantId: w.dress.id, quantity: 3 },
        { variantId: w.bra1.id, quantity: 1 },
      ],
      card(39500),
      { customerId: w.ana.id },
    );
    const items = await itemsOf(sale.id);
    const dressItem = items.find((i) => i.sku === "VES1")!;
    await giveBack(w.cashier, sale.id, [{ saleItemId: dressItem.id, quantity: 2 }]);

    const view = await getReturnableSale(sale.id);
    expect(view).toMatchObject({
      id: sale.id,
      number: sale.number,
      policy: { maxDays: 8, daysSince: 0, outsideWindow: false },
      paymentMethods: ["CARD"],
      originalRefundable: true,
      customer: { id: w.ana.id, name: "Ana Pérez", storeCreditCents: 23000 },
    });
    const dressLine = view?.lines.find((l) => l.sku === "VES1");
    expect(dressLine).toMatchObject({
      quantity: 3,
      returned: 2,
      returnable: 1,
      lineTotalCents: 34500,
      blockedByCategory: false,
    });
    expect(view?.lines.find((l) => l.sku === "INT1")).toMatchObject({
      returnable: 1,
      blockedByCategory: true,
    });

    // Un cobro en efectivo no se devuelve "al mismo método"
    const byCash = await sell(w, w.cashier, [{ variantId: w.shirt.id, quantity: 1 }], cash(20000));
    expect((await getReturnableSale(byCash.id))?.originalRefundable).toBe(false);
    // Anulada o inexistente: nada que devolver
    await voidSale(w.manager, byCash.id, { reason: "Error de cobro" }, testDb);
    expect(await getReturnableSale(byCash.id)).toBeNull();
    expect(await getReturnableSale("no-existe")).toBeNull();
  });

  it("lists the returns of a sale and builds the document to print", async () => {
    const w = await world();
    const sale = await sell(w, w.cashier, [{ variantId: w.dress.id, quantity: 2 }], cash(23000), {
      customerId: w.ana.id,
    });
    const [item] = await itemsOf(sale.id);
    const first = await giveBack(w.cashier, sale.id, [{ saleItemId: item!.id, quantity: 1 }], {
      reason: "No le quedó",
    });
    const second = await giveBack(
      w.cashier,
      sale.id,
      [{ saleItemId: item!.id, quantity: 1, condition: "DAMAGED" }],
      { method: "CASH", managerOverride: MANAGER_PIN, reason: "Llegó rota" },
    );

    const list = await listReturnsOfSale(sale.id);
    expect(list.map((r) => [r.number, r.refundCents, r.refundMethod, r.units])).toEqual([
      [first.number, 11500, "STORE_CREDIT", 1],
      [second.number, 11500, "CASH", 1],
    ]);

    const doc = await getReturnDocument(first.id);
    expect(doc).toMatchObject({
      number: "DV-000001",
      reason: "No le quedó",
      refundMethod: "STORE_CREDIT",
      refundCents: 11500,
      processedByName: "Nombre cashier",
      authorizedByName: null,
      sale: { id: sale.id, number: sale.number },
      customer: { name: "Ana Pérez", storeCreditCents: 11500 },
    });
    expect(doc?.items).toEqual([
      expect.objectContaining({
        productName: "Vestido",
        quantity: 1,
        condition: "RESELLABLE",
        refundCents: 11500,
      }),
    ]);
    expect((await getReturnDocument(second.id))?.authorizedByName).toBe("Nombre manager");
    expect(await getReturnDocument("no-existe")).toBeNull();
  });
});

describe("returns keep the books straight", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("never returns more than was sold and the credit always equals the ledger", async () => {
    const w = await world();
    const customers = [w.ana, w.bea];
    for (let round = 0; round < 6; round += 1) {
      const sale = await sell(w, w.cashier, [{ variantId: w.dress.id, quantity: 3 }], cash(34500), {
        customerId: customers[round % 2]!.id,
      });
      const [item] = await itemsOf(sale.id);
      await giveBack(w.cashier, sale.id, [{ saleItemId: item!.id, quantity: 1 }]);
      await giveBack(w.cashier, sale.id, [{ saleItemId: item!.id, quantity: 2 }], {
        method: round % 3 === 0 ? "CASH" : "STORE_CREDIT",
        managerOverride: MANAGER_PIN,
      });
    }
    // Invariante #3: Σ ReturnItem.quantity ≤ SaleItem.quantity por línea
    const items = await testDb.saleItem.findMany({ include: { returnItems: true } });
    for (const item of items) {
      expect(item.returnItems.reduce((sum, r) => sum + r.quantity, 0)).toBeLessThanOrEqual(
        item.quantity,
      );
      expect(item.returnItems.reduce((sum, r) => sum + r.refundCents, 0)).toBe(item.lineTotalCents);
    }
    // Invariante #5: Customer.storeCreditCents = Σ StoreCreditEntry.amountCents
    for (const customer of await testDb.customer.findMany({
      include: { storeCreditEntries: true },
    })) {
      expect(customer.storeCreditEntries.reduce((sum, e) => sum + e.amountCents, 0)).toBe(
        customer.storeCreditCents,
      );
    }
    expect(await findStockDiscrepancies(testDb)).toEqual([]);
  });
});
