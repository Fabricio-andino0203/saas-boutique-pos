import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { startOfLocalDay } from "@/lib/dates";
import { db } from "@/lib/db";
import {
  AccountLockedError,
  CashSessionClosedError,
  ConflictError,
  DiscountNeedsApprovalError,
  FiscalRangeExhaustedError,
  ForbiddenError,
  InsufficientStockError,
  InvalidCredentialsError,
  NotFoundError,
  SaleStateError,
  ValidationError,
} from "@/lib/errors";
import { hashSecret } from "@/lib/password";
import type { Role } from "@/lib/permissions";
import { setSetting } from "@/lib/settings";
import { loadCashTotals, openCashSession, submitCashClose } from "@/modules/cash/service";
import { findStockDiscrepancies } from "@/modules/inventory/reconcile";
import { recordMovement } from "@/modules/inventory/service";
import { completeSale, voidSale } from "@/modules/sales/service";

import { closeDatabase, resetDatabase, testDb } from "./helpers/db";

const closeAll = async () => {
  await db.$disconnect();
  await closeDatabase();
};

type Actor = { id: string; role: Role };

const PINS = { owner: "1111", manager: "2222", cashier: "3333" } as const;
let pinHashes: Promise<Record<keyof typeof PINS, string>> | undefined;
/** Argon2 es lento a propósito: los PIN de prueba se calculan una sola vez por archivo. */
function getPinHashes() {
  pinHashes ??= (async () => ({
    owner: await hashSecret(PINS.owner),
    manager: await hashSecret(PINS.manager),
    cashier: await hashSecret(PINS.cashier),
  }))();
  return pinHashes;
}

async function world() {
  const hashes = await getPinHashes();
  const make = async (username: string, role: Role, pinHash?: string): Promise<Actor> => {
    const user = await testDb.user.create({
      data: { name: username, username, passwordHash: "x", role, pinHash },
    });
    return { id: user.id, role };
  };
  const owner = await make("owner", "OWNER", hashes.owner);
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
  const category = await testDb.category.create({ data: { name: "Mujer", slug: "mujer" } });
  const [sizeS, sizeM] = await Promise.all(
    ["S", "M"].map((name, index) => testDb.size.create({ data: { name, sortOrder: index + 1 } })),
  );
  const color = await testDb.color.create({ data: { name: "Rojo", hex: "#cc0000" } });

  const product = (
    code: string,
    name: string,
    basePriceCents: number,
    extra: { baseCostCents?: number; taxCategory?: "STANDARD" | "EXEMPT" } = {},
  ) =>
    testDb.product.create({
      data: { code, name, categoryId: category.id, basePriceCents, ...extra },
    });
  const variant = (
    productId: string,
    sku: string,
    barcode: string,
    extra: { sizeId?: string; colorId?: string; avgCostCents?: number } = {},
  ) => testDb.variant.create({ data: { productId, sku, barcode, ...extra } });
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

  const dress = await product("VES1", "Vestido", 11500);
  const shirt = await product("CAM1", "Camisa", 20000, { baseCostCents: 6000 });
  const book = await product("LIB1", "Libro", 5000, { taxCategory: "EXEMPT" });
  const rare = await product("RAR1", "Pieza única", 10000);

  const dressS = await variant(dress.id, "VES1-S", "7001", {
    sizeId: sizeS!.id,
    colorId: color.id,
    avgCostCents: 4000,
  });
  const dressM = await variant(dress.id, "VES1-M", "7002", {
    sizeId: sizeM!.id,
    avgCostCents: 4000,
  });
  const shirtV = await variant(shirt.id, "CAM1", "7003"); // sin costo promedio: usa el del catálogo
  const bookV = await variant(book.id, "LIB1", "7004", { avgCostCents: 2000 });
  const rareV = await variant(rare.id, "RAR1", "7005", { avgCostCents: 3000 });
  await stock(dressS.id, 5);
  await stock(dressM.id, 5);
  await stock(shirtV.id, 3);
  await stock(bookV.id, 4);
  await stock(rareV.id, 1);

  const shift = await openCashSession(cashier, { openingFloatCents: 10000 }, testDb);
  return {
    owner,
    manager,
    cashier,
    cashier2,
    warehouse,
    location,
    terminal,
    shiftId: shift.id,
    dress,
    shirt,
    dressS,
    dressM,
    shirtV,
    bookV,
    rareV,
    stock,
  };
}

type World = Awaited<ReturnType<typeof world>>;

let requestSeq = 0;
const requestId = () => `request-${(requestSeq += 1)}`;

const line = (
  variantId: string,
  quantity: number,
  discount?: { type: "PERCENT"; bps: number } | { type: "AMOUNT"; cents: number },
) => ({ variantId, quantity, ...(discount ? { discount } : {}) });
const cash = (amountCents: number) => ({ method: "CASH" as const, amountCents });
const card = (amountCents: number, reference?: string) => ({
  method: "CARD" as const,
  amountCents,
  reference,
});

type Lines = ReturnType<typeof line>[];
type Payments = (ReturnType<typeof cash> | ReturnType<typeof card>)[];

function sell(
  actor: Actor,
  lines: Lines,
  payments: Payments,
  extra: Record<string, unknown> = {},
  id: string = requestId(),
) {
  return completeSale(actor, { clientRequestId: id, lines, payments, ...extra }, testDb);
}

const onHand = async (variantId: string) =>
  (await testDb.stockLevel.findFirst({ where: { variantId } }))?.onHand ?? 0;

/** Lo que una venta fallida no debe dejar: ni venta, ni pagos, ni salidas de stock, ni número gastado. */
async function expectNothingSold() {
  expect(await testDb.sale.count()).toBe(0);
  expect(await testDb.payment.count()).toBe(0);
  expect(await testDb.stockMovement.count({ where: { type: "SALE_OUT" } })).toBe(0);
  const counter = await testDb.documentCounter.findUnique({ where: { key: "SALE" } });
  expect(counter).toBeNull();
}

const futureDay = () => new Date(Date.now() + 30 * 86_400_000);

async function invoiceRange(
  w: World,
  extra: Partial<{
    prefix: string;
    rangeStart: number;
    rangeEnd: number;
    nextNumber: number;
    expiresAt: Date;
    isActive: boolean;
    terminalId: string | null;
  }> = {},
) {
  return testDb.fiscalRange.create({
    data: {
      documentType: "INVOICE",
      terminalId: w.terminal.id,
      cai: "ABC123-CAI",
      prefix: "000-001-01-",
      rangeStart: 1,
      rangeEnd: 100,
      nextNumber: 1,
      expiresAt: futureDay(),
      ...extra,
    },
  });
}

describe("completeSale: a normal sale", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("records the sale with snapshot lines, payments, stock and the next ticket number", async () => {
    const w = await world();
    const result = await sell(
      w.cashier,
      [line(w.dressS.id, 2), line(w.shirtV.id, 1)],
      [cash(50000)],
    );

    // 2 × 11500 = 23000 (ISV 3000) + 20000 (neto round(200000000 / 11500) = 17391; ISV 2609) = 43000
    expect(result).toMatchObject({
      number: "T-000001",
      totalCents: 43000,
      paidCents: 50000,
      changeCents: 7000,
      fiscalNumber: null,
      replayed: false,
    });
    const sale = await testDb.sale.findUniqueOrThrow({
      where: { id: result.id },
      include: { items: { orderBy: { sku: "asc" } }, payments: true },
    });
    expect(sale).toMatchObject({
      number: "T-000001",
      status: "COMPLETED",
      locationId: w.location.id,
      terminalId: w.terminal.id,
      cashSessionId: w.shiftId,
      sellerId: w.cashier.id,
      customerId: null,
      subtotalCents: 43000,
      discountCents: 0,
      taxCents: 5609,
      totalCents: 43000,
      paidCents: 50000,
      changeCents: 7000,
      fiscalDocType: null,
      fiscalNumber: null,
    });
    // Copia de lo que valía al vender: precio, costo (promedio; sin promedio, el del catálogo), ISV y nombres.
    expect(
      sale.items.map((item) => ({
        sku: item.sku,
        productName: item.productName,
        sizeName: item.sizeName,
        colorName: item.colorName,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        unitCostCents: item.unitCostCents,
        lineDiscountCents: item.lineDiscountCents,
        taxRate: item.taxRate,
        taxCents: item.taxCents,
        lineTotalCents: item.lineTotalCents,
      })),
    ).toEqual([
      {
        sku: "CAM1",
        productName: "Camisa",
        sizeName: null,
        colorName: null,
        quantity: 1,
        unitPriceCents: 20000,
        unitCostCents: 6000,
        lineDiscountCents: 0,
        taxRate: 1500,
        taxCents: 2609,
        lineTotalCents: 20000,
      },
      {
        sku: "VES1-S",
        productName: "Vestido",
        sizeName: "S",
        colorName: "Rojo",
        quantity: 2,
        unitPriceCents: 11500,
        unitCostCents: 4000,
        lineDiscountCents: 0,
        taxRate: 1500,
        taxCents: 3000,
        lineTotalCents: 23000,
      },
    ]);
    expect(sale.payments).toHaveLength(1);
    expect(sale.payments[0]).toMatchObject({
      method: "CASH",
      amountCents: 50000,
      cashSessionId: w.shiftId,
    });

    // El stock bajó por movimientos de salida que apuntan a la venta
    expect(await onHand(w.dressS.id)).toBe(3);
    expect(await onHand(w.shirtV.id)).toBe(2);
    const movements = await testDb.stockMovement.findMany({
      where: { type: "SALE_OUT" },
      orderBy: { quantity: "asc" },
    });
    expect(
      movements.map((m) => [m.quantity, m.unitCostCents, m.refType, m.refId, m.userId]),
    ).toEqual([
      [-2, 4000, "Sale", result.id, w.cashier.id],
      [-1, 6000, "Sale", result.id, w.cashier.id],
    ]);
    expect(await findStockDiscrepancies(testDb)).toEqual([]);
  });

  it("numbers the sales one after another", async () => {
    const w = await world();
    const first = await sell(w.cashier, [line(w.dressS.id, 1)], [cash(11500)]);
    const second = await sell(w.cashier, [line(w.dressS.id, 1)], [cash(11500)]);
    expect([first.number, second.number]).toEqual(["T-000001", "T-000002"]);
  });

  it("keeps what was sold even if the catalog price changes later", async () => {
    const w = await world();
    const result = await sell(w.cashier, [line(w.dressS.id, 1)], [cash(11500)]);
    await testDb.product.update({ where: { id: w.dress.id }, data: { basePriceCents: 99999 } });
    await testDb.variant.update({ where: { id: w.dressS.id }, data: { avgCostCents: 77777 } });
    const item = await testDb.saleItem.findFirstOrThrow({ where: { saleId: result.id } });
    expect(item).toMatchObject({
      unitPriceCents: 11500,
      unitCostCents: 4000,
      lineTotalCents: 11500,
    });
  });

  it("uses the variant's own price when it has one", async () => {
    const w = await world();
    await testDb.variant.update({ where: { id: w.dressM.id }, data: { priceCents: 9000 } });
    const result = await sell(w.cashier, [line(w.dressM.id, 1)], [cash(9000)]);
    expect(result.totalCents).toBe(9000);
  });

  it("takes a mixed payment and gives the change from the cash part", async () => {
    const w = await world();
    const result = await sell(
      w.cashier,
      [line(w.dressS.id, 2)],
      [card(10000, "4242"), cash(15000)],
    );
    expect(result).toMatchObject({ totalCents: 23000, paidCents: 25000, changeCents: 2000 });
    const payments = await testDb.payment.findMany({
      where: { saleId: result.id },
      orderBy: { amountCents: "asc" },
    });
    expect(payments.map((p) => [p.method, p.amountCents, p.reference])).toEqual([
      ["CARD", 10000, "4242"],
      ["CASH", 15000, null],
    ]);
  });

  it("lets another cashier sell into the shift that is open on the terminal", async () => {
    const w = await world();
    const result = await sell(w.cashier2, [line(w.dressS.id, 1)], [cash(11500)]);
    const sale = await testDb.sale.findUniqueOrThrow({ where: { id: result.id } });
    expect(sale).toMatchObject({ sellerId: w.cashier2.id, cashSessionId: w.shiftId });
  });

  it("refuses roles that cannot sell", async () => {
    const w = await world();
    await expect(sell(w.warehouse, [line(w.dressS.id, 1)], [cash(11500)])).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expectNothingSold();
  });

  it("refuses a malformed sale", async () => {
    const w = await world();
    await expect(
      completeSale(w.cashier, { clientRequestId: "x", lines: [], payments: [] }, testDb),
    ).rejects.toBeInstanceOf(ValidationError);
    await expectNothingSold();
  });
});

describe("completeSale: ISV settings", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("adds the ISV on top when the prices do not include it", async () => {
    const w = await world();
    await setSetting(testDb, "tax.pricesIncludeTax", false);
    // 11500 + 15 % (1725) = 13225
    const result = await sell(w.cashier, [line(w.dressS.id, 1)], [cash(15000)]);
    expect(result).toMatchObject({ totalCents: 13225, changeCents: 1775 });
    const sale = await testDb.sale.findUniqueOrThrow({ where: { id: result.id } });
    expect(sale).toMatchObject({ subtotalCents: 11500, taxCents: 1725, totalCents: 13225 });
  });

  it("charges no ISV on exempt garments", async () => {
    const w = await world();
    const result = await sell(w.cashier, [line(w.bookV.id, 1)], [cash(5000)]);
    const item = await testDb.saleItem.findFirstOrThrow({ where: { saleId: result.id } });
    expect(item).toMatchObject({ taxRate: 0, taxCents: 0, lineTotalCents: 5000 });
  });

  it("follows the rate in the settings", async () => {
    const w = await world();
    await setSetting(testDb, "tax.rate", 0);
    const result = await sell(w.cashier, [line(w.dressS.id, 1)], [cash(11500)]);
    expect((await testDb.sale.findUniqueOrThrow({ where: { id: result.id } })).taxCents).toBe(0);
  });
});

describe("completeSale: payments", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("refuses to be paid less than the total", async () => {
    const w = await world();
    await expect(sell(w.cashier, [line(w.dressS.id, 2)], [cash(22999)])).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expectNothingSold();
  });

  it("refuses change that would come from a card", async () => {
    const w = await world();
    await expect(sell(w.cashier, [line(w.dressS.id, 2)], [card(24000)])).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expectNothingSold();
  });

  it("refuses a payment method that is turned off", async () => {
    const w = await world();
    await setSetting(testDb, "payments.enabled", ["CASH"]);
    await expect(sell(w.cashier, [line(w.dressS.id, 1)], [card(11500)])).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expectNothingSold();
  });

  it("refuses a sale with nothing to pay", async () => {
    const w = await world();
    await expect(
      sell(w.manager, [line(w.dressS.id, 1)], [cash(100)], {
        discount: { type: "PERCENT", bps: 10000 },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expectNothingSold();
  });

  it("refuses an unknown customer", async () => {
    const w = await world();
    await expect(
      sell(w.cashier, [line(w.dressS.id, 1)], [cash(11500)], { customerId: "no-existe" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expectNothingSold();
  });

  it("links a known customer to the sale", async () => {
    const w = await world();
    const customer = await testDb.customer.create({ data: { name: "Ana", phone: "9999-0000" } });
    const result = await sell(w.cashier, [line(w.dressS.id, 1)], [cash(11500)], {
      customerId: customer.id,
    });
    expect((await testDb.sale.findUniqueOrThrow({ where: { id: result.id } })).customerId).toBe(
      customer.id,
    );
  });
});

describe("completeSale: discounts", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("lets a cashier discount up to the limit without anyone's approval", async () => {
    const w = await world();
    // 10 % de 23000 = 2300; línea 20700; neto 18000, ISV 2700
    const result = await sell(
      w.cashier,
      [line(w.dressS.id, 2, { type: "PERCENT", bps: 1000 })],
      [cash(20700)],
    );
    expect(result.totalCents).toBe(20700);
    const item = await testDb.saleItem.findFirstOrThrow({ where: { saleId: result.id } });
    expect(item).toMatchObject({ lineDiscountCents: 2300, taxCents: 2700, lineTotalCents: 20700 });
    expect(await testDb.auditLog.count({ where: { action: "DISCOUNT_OVERRIDE" } })).toBe(0);
  });

  it("stops a cashier at 11 % and says a manager must authorize", async () => {
    const w = await world();
    await expect(
      sell(w.cashier, [line(w.dressS.id, 2, { type: "PERCENT", bps: 1100 })], [cash(23000)]),
    ).rejects.toBeInstanceOf(DiscountNeedsApprovalError);
    await expectNothingSold();
  });

  it("also stops a global discount over the limit, and a fixed amount over the limit", async () => {
    const w = await world();
    await expect(
      sell(w.cashier, [line(w.dressS.id, 2)], [cash(23000)], {
        discount: { type: "PERCENT", bps: 1500 },
      }),
    ).rejects.toBeInstanceOf(DiscountNeedsApprovalError);
    // 2301 de 23000 es más del 10 %
    await expect(
      sell(w.cashier, [line(w.dressS.id, 2, { type: "AMOUNT", cents: 2301 })], [cash(23000)]),
    ).rejects.toBeInstanceOf(DiscountNeedsApprovalError);
    // 2300 justo es el 10 %: pasa
    await expect(
      sell(w.cashier, [line(w.dressS.id, 2, { type: "AMOUNT", cents: 2300 })], [cash(23000)]),
    ).resolves.toHaveProperty("id");
  });

  it("accepts a discount over the limit with a manager's PIN and records who authorized it", async () => {
    const w = await world();
    const result = await sell(
      w.cashier,
      [line(w.dressS.id, 2, { type: "PERCENT", bps: 2000 })],
      [cash(20000)],
      { managerOverride: { username: "manager", pin: PINS.manager } },
    );
    expect(result.totalCents).toBe(18400); // 23000 − 20 %
    const log = await testDb.auditLog.findFirstOrThrow({ where: { action: "DISCOUNT_OVERRIDE" } });
    expect(log).toMatchObject({
      userId: w.cashier.id,
      entityType: "Sale",
      entityId: result.id,
    });
    expect(log.after).toEqual({
      authorizedById: w.manager.id,
      discountCents: 4600,
      totalCents: 18400,
    });
  });

  it("does not record an override when the PIN was not needed", async () => {
    const w = await world();
    await sell(w.cashier, [line(w.dressS.id, 1)], [cash(11500)], {
      managerOverride: { username: "manager", pin: PINS.manager },
    });
    expect(await testDb.auditLog.count({ where: { action: "DISCOUNT_OVERRIDE" } })).toBe(0);
  });

  it("refuses a wrong PIN, and a PIN of someone who cannot authorize", async () => {
    const w = await world();
    const discounted = [line(w.dressS.id, 2, { type: "PERCENT", bps: 2000 })];
    await expect(
      sell(w.cashier, discounted, [cash(20000)], {
        managerOverride: { username: "manager", pin: "9999" },
      }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    await expect(
      sell(w.cashier, discounted, [cash(20000)], {
        managerOverride: { username: "nadie", pin: "1234" },
      }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    await expect(
      sell(w.cashier, discounted, [cash(20000)], {
        managerOverride: { username: "cashier", pin: PINS.cashier },
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expectNothingSold();
  });

  it("locks the manager's PIN after five wrong tries", async () => {
    const w = await world();
    const discounted = [line(w.dressS.id, 2, { type: "PERCENT", bps: 2000 })];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(
        sell(w.cashier, discounted, [cash(20000)], {
          managerOverride: { username: "manager", pin: "9999" },
        }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    }
    await expect(
      sell(w.cashier, discounted, [cash(20000)], {
        managerOverride: { username: "manager", pin: "9999" },
      }),
    ).rejects.toBeInstanceOf(AccountLockedError);
    // Ya bloqueado, ni el PIN correcto sirve
    await expect(
      sell(w.cashier, discounted, [cash(20000)], {
        managerOverride: { username: "manager", pin: PINS.manager },
      }),
    ).rejects.toBeInstanceOf(AccountLockedError);
    await expectNothingSold();
  });

  it("lets a manager discount over the cashier limit without a PIN", async () => {
    const w = await world();
    const result = await sell(
      w.manager,
      [line(w.dressS.id, 2, { type: "PERCENT", bps: 5000 })],
      [cash(11500)],
    );
    expect(result.totalCents).toBe(11500);
    expect(await testDb.auditLog.count({ where: { action: "DISCOUNT_OVERRIDE" } })).toBe(0);
  });

  it("prorates a global discount between the lines so nothing is lost", async () => {
    const w = await world();
    // 23000 + 20000 = 43000; 10 % global = 4300 → 2300 y 2000; totales 20700 y 18000 (suma 38700).
    // ISV: 2700 y (neto round(180000000 / 11500) = 15652) 2348.
    const result = await sell(
      w.cashier,
      [line(w.dressS.id, 2), line(w.shirtV.id, 1)],
      [cash(38700)],
      {
        discount: { type: "PERCENT", bps: 1000 },
      },
    );
    expect(result.totalCents).toBe(38700);
    const sale = await testDb.sale.findUniqueOrThrow({
      where: { id: result.id },
      include: { items: { orderBy: { sku: "asc" } } },
    });
    expect(sale).toMatchObject({
      subtotalCents: 43000,
      discountCents: 4300,
      taxCents: 5048,
      totalCents: 38700,
    });
    expect(
      sale.items.map((i) => [i.sku, i.lineDiscountCents, i.lineTotalCents, i.taxCents]),
    ).toEqual([
      ["CAM1", 2000, 18000, 2348],
      ["VES1-S", 2300, 20700, 2700],
    ]);
    // Invariante: la suma de las líneas es el total de la venta
    expect(sale.items.reduce((sum, i) => sum + i.lineTotalCents, 0)).toBe(sale.totalCents);
  });

  it("refuses a discount bigger than what it applies to", async () => {
    const w = await world();
    await expect(
      sell(w.manager, [line(w.dressS.id, 1)], [cash(11500)], {
        discount: { type: "AMOUNT", cents: 11501 },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expectNothingSold();
  });

  it("follows the limit in the settings", async () => {
    const w = await world();
    await setSetting(testDb, "discount.maxPercent.CASHIER", 0);
    await expect(
      sell(w.cashier, [line(w.dressS.id, 1, { type: "PERCENT", bps: 100 })], [cash(11500)]),
    ).rejects.toBeInstanceOf(DiscountNeedsApprovalError);
    await setSetting(testDb, "discount.maxPercent.CASHIER", 30);
    await expect(
      sell(w.cashier, [line(w.dressS.id, 1, { type: "PERCENT", bps: 3000 })], [cash(11500)]),
    ).resolves.toHaveProperty("id");
  });
});

describe("completeSale: the cash shift", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("does not sell without an open shift on the terminal", async () => {
    const w = await world();
    await submitCashClose(w.cashier, { countedCashCents: 10000 }, testDb);
    await expect(sell(w.cashier, [line(w.dressS.id, 1)], [cash(11500)])).rejects.toBeInstanceOf(
      CashSessionClosedError,
    );
    await expectNothingSold();
    expect(await onHand(w.dressS.id)).toBe(5);
  });

  it("adds the cash of the sale to what the shift should have", async () => {
    const w = await world();
    // Efectivo 15000 por una venta de 11500: vuelto 3500. Esperado = 10000 + 15000 − 3500
    await sell(w.cashier, [line(w.dressS.id, 1)], [cash(15000)]);
    // Tarjeta: no entra al cajón
    await sell(w.cashier, [line(w.dressS.id, 1)], [card(11500)]);
    const totals = await loadCashTotals(testDb, w.shiftId);
    expect(totals).toEqual({
      openingFloatCents: 10000,
      cashPaymentsCents: 15000,
      changeGivenCents: 3500,
      movementsInCents: 0,
      movementsOutCents: 0,
      cashRefundsCents: 0,
    });
    await expect(
      submitCashClose(w.cashier, { countedCashCents: 21500 }, testDb),
    ).resolves.toMatchObject({
      expectedCents: 21500,
      differenceCents: 0,
    });
  });
});

describe("completeSale: idempotency", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("returns the same sale when the same request is sent again", async () => {
    const w = await world();
    const id = requestId();
    const first = await sell(w.cashier, [line(w.dressS.id, 1)], [cash(11500)], {}, id);
    const again = await sell(w.cashier, [line(w.dressS.id, 1)], [cash(11500)], {}, id);
    expect(first.replayed).toBe(false);
    expect(again).toEqual({ ...first, replayed: true });
    expect(await testDb.sale.count()).toBe(1);
    expect(await onHand(w.dressS.id)).toBe(4);
    expect(
      (await testDb.documentCounter.findUniqueOrThrow({ where: { key: "SALE" } })).nextValue,
    ).toBe(2);
  });

  it("does not duplicate the sale when the button is pressed several times at once", async () => {
    const w = await world();
    const id = requestId();
    const results = await Promise.all(
      [1, 2, 3].map(() => sell(w.cashier, [line(w.dressS.id, 1)], [cash(11500)], {}, id)),
    );
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(await testDb.sale.count()).toBe(1);
    expect(await testDb.payment.count()).toBe(1);
    expect(await onHand(w.dressS.id)).toBe(4);
  });

  it("does not hand someone else's sale back to another person", async () => {
    const w = await world();
    const id = requestId();
    await sell(w.cashier, [line(w.dressS.id, 1)], [cash(11500)], {}, id);
    await expect(
      sell(w.cashier2, [line(w.dressS.id, 1)], [cash(11500)], {}, id),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("returns the sale even after the shift closed (the customer already paid)", async () => {
    const w = await world();
    const id = requestId();
    const first = await sell(w.cashier, [line(w.dressS.id, 1)], [cash(11500)], {}, id);
    await submitCashClose(w.cashier, { countedCashCents: 21500 }, testDb);
    await expect(sell(w.cashier, [line(w.dressS.id, 1)], [cash(11500)], {}, id)).resolves.toEqual({
      ...first,
      replayed: true,
    });
  });
});

describe("completeSale: stock", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("refuses to sell what is not there and says which garment", async () => {
    const w = await world();
    const error = await sell(w.cashier, [line(w.dressS.id, 6)], [cash(69000)]).catch((e) => e);
    expect(error).toBeInstanceOf(InsufficientStockError);
    expect((error as InsufficientStockError).variantId).toBe(w.dressS.id);
    await expectNothingSold();
    expect(await onHand(w.dressS.id)).toBe(5);
  });

  it("is all or nothing: a line that fails undoes the lines before it", async () => {
    const w = await world();
    await expect(
      sell(w.cashier, [line(w.dressS.id, 2), line(w.shirtV.id, 99)], [cash(2003000)]),
    ).rejects.toBeInstanceOf(InsufficientStockError);
    await expectNothingSold();
    expect(await onHand(w.dressS.id)).toBe(5);
    expect(await onHand(w.shirtV.id)).toBe(3);
    // y el número del ticket no se gastó
    const ok = await sell(w.cashier, [line(w.dressS.id, 1)], [cash(11500)]);
    expect(ok.number).toBe("T-000001");
  });

  it("lets only one of two cashiers sell the last garment", async () => {
    const w = await world();
    const results = await Promise.allSettled([
      sell(w.cashier, [line(w.rareV.id, 1)], [cash(10000)]),
      sell(w.cashier2, [line(w.rareV.id, 1)], [cash(10000)]),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason).toBeInstanceOf(
      InsufficientStockError,
    );
    expect(await onHand(w.rareV.id)).toBe(0);
    expect(await testDb.sale.count()).toBe(1);
    expect(await findStockDiscrepancies(testDb)).toEqual([]);
  });

  it("counts repeated lines of the same garment together", async () => {
    const w = await world();
    await expect(
      sell(w.cashier, [line(w.dressS.id, 3), line(w.dressS.id, 3)], [cash(69000)]),
    ).rejects.toBeInstanceOf(InsufficientStockError);
    expect(await onHand(w.dressS.id)).toBe(5);
    await sell(w.cashier, [line(w.dressS.id, 2), line(w.dressS.id, 2)], [cash(46000)]);
    expect(await onHand(w.dressS.id)).toBe(1);
  });

  it("can sell below zero when the setting allows it", async () => {
    const w = await world();
    await setSetting(testDb, "sales.allowNegativeStock", true);
    await sell(w.cashier, [line(w.rareV.id, 2)], [cash(20000)]);
    expect(await onHand(w.rareV.id)).toBe(-1);
    expect(await findStockDiscrepancies(testDb)).toEqual([]);
  });

  it("does not sell archived or unknown garments", async () => {
    const w = await world();
    await testDb.variant.update({ where: { id: w.dressM.id }, data: { archivedAt: new Date() } });
    await expect(sell(w.cashier, [line(w.dressM.id, 1)], [cash(11500)])).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(sell(w.cashier, [line("no-existe", 1)], [cash(11500)])).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await testDb.product.update({ where: { id: w.dress.id }, data: { archivedAt: new Date() } });
    await expect(sell(w.cashier, [line(w.dressS.id, 1)], [cash(11500)])).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expectNothingSold();
  });
});

describe("completeSale: invoices with CAI", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("issues consecutive invoice numbers and keeps them apart from the tickets", async () => {
    const w = await world();
    const range = await invoiceRange(w);
    const a = await sell(w.cashier, [line(w.dressS.id, 1)], [cash(11500)], {
      invoice: { taxId: "0801-1990-00001", name: "Ana Pérez" },
    });
    const plain = await sell(w.cashier, [line(w.dressS.id, 1)], [cash(11500)]);
    const b = await sell(w.cashier, [line(w.dressS.id, 1)], [cash(11500)], { invoice: {} });
    expect(a.fiscalNumber).toBe("000-001-01-00000001");
    expect(plain.fiscalNumber).toBeNull();
    expect(b.fiscalNumber).toBe("000-001-01-00000002");
    expect([a.number, plain.number, b.number]).toEqual(["T-000001", "T-000002", "T-000003"]);

    const saleA = await testDb.sale.findUniqueOrThrow({ where: { id: a.id } });
    expect(saleA).toMatchObject({
      fiscalDocType: "INVOICE",
      fiscalNumber: 1,
      fiscalRangeId: range.id,
      customerTaxId: "0801-1990-00001",
      customerNameOnInvoice: "Ana Pérez",
    });
    expect(
      (await testDb.fiscalRange.findUniqueOrThrow({ where: { id: range.id } })).nextNumber,
    ).toBe(3);
  });

  it("does not issue when there is no usable range, and leaves nothing behind", async () => {
    const w = await world();
    await expect(
      sell(w.cashier, [line(w.dressS.id, 1)], [cash(11500)], { invoice: {} }),
    ).rejects.toBeInstanceOf(FiscalRangeExhaustedError);
    await invoiceRange(w, { isActive: false });
    await expect(
      sell(w.cashier, [line(w.dressS.id, 1)], [cash(11500)], { invoice: {} }),
    ).rejects.toBeInstanceOf(FiscalRangeExhaustedError);
    await expectNothingSold();
    expect(await onHand(w.dressS.id)).toBe(5);
  });

  it("stops at the last number of the range without consuming anything", async () => {
    const w = await world();
    const range = await invoiceRange(w, { rangeEnd: 2, nextNumber: 2 });
    await expect(
      sell(w.cashier, [line(w.dressS.id, 1)], [cash(11500)], { invoice: {} }),
    ).resolves.toMatchObject({ fiscalNumber: "000-001-01-00000002" });
    await expect(
      sell(w.cashier, [line(w.dressS.id, 1)], [cash(11500)], { invoice: {} }),
    ).rejects.toBeInstanceOf(FiscalRangeExhaustedError);
    expect(await testDb.sale.count()).toBe(1);
    expect(
      (await testDb.fiscalRange.findUniqueOrThrow({ where: { id: range.id } })).nextNumber,
    ).toBe(3);
    // Un ticket sin factura sigue pudiéndose vender
    await expect(sell(w.cashier, [line(w.dressS.id, 1)], [cash(11500)])).resolves.toHaveProperty(
      "id",
    );
  });

  it("refuses an expired range but still works on its last day", async () => {
    const w = await world();
    await invoiceRange(w, { expiresAt: new Date(Date.now() - 2 * 86_400_000) });
    await expect(
      sell(w.cashier, [line(w.dressS.id, 1)], [cash(11500)], { invoice: {} }),
    ).rejects.toBeInstanceOf(FiscalRangeExhaustedError);
    await testDb.fiscalRange.deleteMany();

    // La fecha límite guardada es el mediodía local de ese día; vale hasta que termina el día.
    await invoiceRange(w, { expiresAt: startOfLocalDay(new Date()) });
    await expect(
      sell(w.cashier, [line(w.dressS.id, 1)], [cash(11500)], { invoice: {} }),
    ).resolves.toHaveProperty("fiscalNumber");
  });

  it("prefers the terminal's own range over the general one", async () => {
    const w = await world();
    await invoiceRange(w, { prefix: "G-", terminalId: null });
    await invoiceRange(w, { prefix: "T1-" });
    const result = await sell(w.cashier, [line(w.dressS.id, 1)], [cash(11500)], { invoice: {} });
    expect(result.fiscalNumber).toBe("T1-00000001");
  });

  it("falls back to the general range when the terminal has none", async () => {
    const w = await world();
    await invoiceRange(w, { prefix: "G-", terminalId: null });
    const result = await sell(w.cashier, [line(w.dressS.id, 1)], [cash(11500)], { invoice: {} });
    expect(result.fiscalNumber).toBe("G-00000001");
  });

  it("never repeats or skips a number when invoices are issued at the same time", async () => {
    const w = await world();
    await invoiceRange(w);
    const results = await Promise.all(
      [w.cashier, w.cashier2, w.cashier, w.cashier2].map((actor) =>
        sell(actor, [line(w.dressM.id, 1)], [cash(11500)], { invoice: {} }),
      ),
    );
    const numbers = results.map((r) => r.fiscalNumber).sort();
    expect(numbers).toEqual([
      "000-001-01-00000001",
      "000-001-01-00000002",
      "000-001-01-00000003",
      "000-001-01-00000004",
    ]);
    const tickets = results.map((r) => r.number).sort();
    expect(tickets).toEqual(["T-000001", "T-000002", "T-000003", "T-000004"]);
  });

  it("gives the invoice number back when the sale fails afterwards", async () => {
    const w = await world();
    const range = await invoiceRange(w);
    await expect(
      sell(w.cashier, [line(w.dressS.id, 99)], [cash(99999999)], { invoice: {} }),
    ).rejects.toBeInstanceOf(InsufficientStockError);
    expect(
      (await testDb.fiscalRange.findUniqueOrThrow({ where: { id: range.id } })).nextNumber,
    ).toBe(1);
  });
});

describe("voidSale", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("returns the garments to the shelf, marks the sale and leaves a trace", async () => {
    const w = await world();
    const sale = await sell(w.cashier, [line(w.dressS.id, 2), line(w.shirtV.id, 1)], [cash(43000)]);
    await expect(
      voidSale(w.manager, sale.id, { reason: "Se equivocó de talla" }, testDb),
    ).resolves.toEqual({ id: sale.id, number: "T-000001" });

    const row = await testDb.sale.findUniqueOrThrow({ where: { id: sale.id } });
    expect(row).toMatchObject({
      status: "VOIDED",
      voidReason: "Se equivocó de talla",
      voidedById: w.manager.id,
      totalCents: 43000,
    });
    expect(row.voidedAt).toBeInstanceOf(Date);

    expect(await onHand(w.dressS.id)).toBe(5);
    expect(await onHand(w.shirtV.id)).toBe(3);
    const back = await testDb.stockMovement.findMany({
      where: { type: "RETURN_IN" },
      orderBy: { quantity: "desc" },
    });
    expect(back.map((m) => [m.quantity, m.unitCostCents, m.refType, m.refId, m.reason])).toEqual([
      [2, 4000, "Sale", sale.id, "Anulación de venta T-000001"],
      [1, 6000, "Sale", sale.id, "Anulación de venta T-000001"],
    ]);

    const log = await testDb.auditLog.findFirstOrThrow({ where: { action: "SALE_VOIDED" } });
    expect(log).toMatchObject({
      userId: w.manager.id,
      entityType: "Sale",
      entityId: sale.id,
      reason: "Se equivocó de talla",
    });
    expect(log.before).toEqual({ status: "COMPLETED", totalCents: 43000 });
    expect(log.after).toEqual({ status: "VOIDED" });
    expect(await findStockDiscrepancies(testDb)).toEqual([]);
  });

  it("removes a voided sale from the cash the shift should have", async () => {
    const w = await world();
    const keep = await sell(w.cashier, [line(w.dressS.id, 1)], [cash(15000)]);
    const gone = await sell(w.cashier, [line(w.dressM.id, 1)], [cash(20000)]);
    await voidSale(w.owner, gone.id, { reason: "Cliente se arrepintió" }, testDb);
    const totals = await loadCashTotals(testDb, w.shiftId);
    // Solo cuenta la primera: efectivo 15000, vuelto 3500
    expect(totals).toMatchObject({ cashPaymentsCents: 15000, changeGivenCents: 3500 });
    expect(keep.id).not.toBe(gone.id);
  });

  it("needs a manager: a cashier alone is refused", async () => {
    const w = await world();
    const sale = await sell(w.cashier, [line(w.dressS.id, 1)], [cash(11500)]);
    await expect(
      voidSale(w.cashier, sale.id, { reason: "Error de cobro" }, testDb),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect((await testDb.sale.findUniqueOrThrow({ where: { id: sale.id } })).status).toBe(
      "COMPLETED",
    );
  });

  it("lets a cashier void with a manager's PIN and records both people", async () => {
    const w = await world();
    const sale = await sell(w.cashier, [line(w.dressS.id, 1)], [cash(11500)]);
    await voidSale(
      w.cashier,
      sale.id,
      { reason: "Error de cobro", managerOverride: { username: "manager", pin: PINS.manager } },
      testDb,
    );
    const row = await testDb.sale.findUniqueOrThrow({ where: { id: sale.id } });
    expect(row).toMatchObject({ status: "VOIDED", voidedById: w.manager.id });
    const log = await testDb.auditLog.findFirstOrThrow({ where: { action: "SALE_VOIDED" } });
    expect(log.userId).toBe(w.cashier.id);
    expect(log.after).toEqual({ status: "VOIDED", authorizedById: w.manager.id });
  });

  it("refuses a wrong PIN and a PIN of someone who cannot void", async () => {
    const w = await world();
    const sale = await sell(w.cashier, [line(w.dressS.id, 1)], [cash(11500)]);
    await expect(
      voidSale(
        w.cashier,
        sale.id,
        { reason: "Error de cobro", managerOverride: { username: "manager", pin: "9999" } },
        testDb,
      ),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    await expect(
      voidSale(
        w.cashier,
        sale.id,
        { reason: "Error de cobro", managerOverride: { username: "cashier", pin: PINS.cashier } },
        testDb,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect((await testDb.sale.findUniqueOrThrow({ where: { id: sale.id } })).status).toBe(
      "COMPLETED",
    );
    expect(await onHand(w.dressS.id)).toBe(4);
  });

  it("asks for a reason", async () => {
    const w = await world();
    const sale = await sell(w.cashier, [line(w.dressS.id, 1)], [cash(11500)]);
    for (const reason of ["", "  ", "ab"]) {
      await expect(voidSale(w.manager, sale.id, { reason }, testDb)).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
    await expect(voidSale(w.manager, sale.id, {}, testDb)).rejects.toBeInstanceOf(ValidationError);
  });

  it("voids only once, even when two people press at the same time", async () => {
    const w = await world();
    const sale = await sell(w.cashier, [line(w.dressS.id, 2)], [cash(23000)]);
    const results = await Promise.allSettled([
      voidSale(w.manager, sale.id, { reason: "Primera anulación" }, testDb),
      voidSale(w.owner, sale.id, { reason: "Segunda anulación" }, testDb),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason).toBeInstanceOf(SaleStateError);
    expect(await onHand(w.dressS.id)).toBe(5); // devuelta una sola vez
    expect(await testDb.auditLog.count({ where: { action: "SALE_VOIDED" } })).toBe(1);
  });

  it("does not void a sale that does not exist", async () => {
    const w = await world();
    await expect(
      voidSale(w.manager, "no-existe", { reason: "Prueba de anulación" }, testDb),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("does not void a sale from a shift that is already closed", async () => {
    const w = await world();
    const sale = await sell(w.cashier, [line(w.dressS.id, 1)], [cash(11500)]);
    await submitCashClose(w.cashier, { countedCashCents: 21500 }, testDb);
    await expect(
      voidSale(w.manager, sale.id, { reason: "Llegó tarde" }, testDb),
    ).rejects.toBeInstanceOf(SaleStateError);
    expect((await testDb.sale.findUniqueOrThrow({ where: { id: sale.id } })).status).toBe(
      "COMPLETED",
    );
    expect(await onHand(w.dressS.id)).toBe(4);
  });

  it("keeps the invoice number used, so numbering never has gaps", async () => {
    const w = await world();
    await invoiceRange(w);
    const first = await sell(w.cashier, [line(w.dressS.id, 1)], [cash(11500)], { invoice: {} });
    await voidSale(w.manager, first.id, { reason: "Datos mal escritos" }, testDb);
    const second = await sell(w.cashier, [line(w.dressS.id, 1)], [cash(11500)], { invoice: {} });
    expect(second.fiscalNumber).toBe("000-001-01-00000002");
    const voided = await testDb.sale.findUniqueOrThrow({ where: { id: first.id } });
    expect(voided).toMatchObject({ status: "VOIDED", fiscalNumber: 1 });
  });
});

describe("sales invariants", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("keeps payments − change = total and Σ lines = total for every sale", async () => {
    const w = await world();
    await sell(w.cashier, [line(w.dressS.id, 2), line(w.shirtV.id, 1)], [card(10000), cash(40000)]);
    await sell(w.cashier, [line(w.dressM.id, 3, { type: "PERCENT", bps: 700 })], [cash(40000)]);
    await sell(w.manager, [line(w.bookV.id, 2)], [cash(10000)], {
      discount: { type: "AMOUNT", cents: 333 },
    });
    const sales = await testDb.sale.findMany({ include: { items: true, payments: true } });
    expect(sales).toHaveLength(3);
    for (const sale of sales) {
      const paid = sale.payments.reduce((sum, p) => sum + p.amountCents, 0);
      expect(paid).toBe(sale.paidCents);
      expect(sale.paidCents - sale.changeCents).toBe(sale.totalCents);
      expect(sale.items.reduce((sum, i) => sum + i.lineTotalCents, 0)).toBe(sale.totalCents);
      expect(sale.items.reduce((sum, i) => sum + i.taxCents, 0)).toBe(sale.taxCents);
    }
    expect(await findStockDiscrepancies(testDb)).toEqual([]);
  });
});
