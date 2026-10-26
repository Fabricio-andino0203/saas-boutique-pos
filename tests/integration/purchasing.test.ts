import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  ForbiddenError,
  NotFoundError,
  OrderStateError,
  OverReceiptError,
  ValidationError,
} from "@/lib/errors";
import type { Role } from "@/lib/permissions";
import { findStockDiscrepancies } from "@/modules/inventory/reconcile";
import { getKardex } from "@/modules/inventory/queries";
import { recordMovement } from "@/modules/inventory/service";
import {
  getPurchaseOrder,
  getReceipt,
  listPurchaseOrders,
  listReceipts,
  searchPurchasableVariants,
} from "@/modules/purchasing/queries";
import {
  cancelPurchaseOrder,
  createPurchaseOrder,
  placePurchaseOrder,
  receiveGoods,
  updatePurchaseOrder,
} from "@/modules/purchasing/service";

import { closeDatabase, resetDatabase, testDb } from "./helpers/db";

type Actor = { id: string; role: Role };

async function world() {
  const make = async (username: string, role: Role): Promise<Actor> => {
    const user = await testDb.user.create({
      data: { name: username, username, passwordHash: "x", role },
    });
    return { id: user.id, role };
  };
  const owner = await make("owner", "OWNER");
  const manager = await make("manager", "MANAGER");
  const warehouse = await make("warehouse", "WAREHOUSE");
  const cashier = await make("cashier", "CASHIER");
  const location = await testDb.location.create({
    data: { code: "MAIN", name: "Tienda principal", isDefault: true },
  });
  const supplier = await testDb.supplier.create({ data: { name: "Textiles SA" } });
  const category = await testDb.category.create({ data: { name: "Mujer", slug: "mujer" } });
  const product = await testDb.product.create({
    data: {
      code: "COM1",
      name: "Vestido floral",
      categoryId: category.id,
      basePriceCents: 100000,
      baseCostCents: 3000,
    },
  });
  const [s, m] = await Promise.all([
    testDb.size.create({ data: { name: "S", sortOrder: 1 } }),
    testDb.size.create({ data: { name: "M", sortOrder: 2 } }),
  ]);
  const variant = (sizeId: string, sku: string, barcode: string, avgCostCents = 0) =>
    testDb.variant.create({
      data: { productId: product.id, sizeId, sku, barcode, avgCostCents },
    });
  const small = await variant(s.id, "COM1-S", "2000000000015");
  const medium = await variant(m.id, "COM1-M", "2000000000022");
  return { owner, manager, warehouse, cashier, location, supplier, small, medium };
}

type World = Awaited<ReturnType<typeof world>>;

const orderInput = (w: World, overrides: object = {}) => ({
  supplierId: w.supplier.id,
  items: [
    { variantId: w.small.id, orderedQty: 100, unitCostCents: 5000 },
    { variantId: w.medium.id, orderedQty: 40, unitCostCents: 5500 },
  ],
  ...overrides,
});

async function onHand(variantId: string): Promise<number> {
  return (await testDb.stockLevel.findFirst({ where: { variantId } }))?.onHand ?? 0;
}
const avgCost = async (variantId: string) =>
  (await testDb.variant.findUniqueOrThrow({ where: { id: variantId } })).avgCostCents;

describe("purchase orders", () => {
  beforeEach(resetDatabase);
  afterAll(closeDatabase);

  it("creates a draft with a correlative number, its lines and its location", async () => {
    const w = await world();
    const first = await createPurchaseOrder(w.manager, orderInput(w, { notes: "Urgente" }), testDb);
    const second = await createPurchaseOrder(w.owner, orderInput(w), testDb);
    expect(first.number).toBe("OC-000001");
    expect(second.number).toBe("OC-000002");

    const order = (await getPurchaseOrder(first.id, { includeCost: true }, testDb))!;
    expect(order).toMatchObject({
      status: "DRAFT",
      supplierName: "Textiles SA",
      notes: "Urgente",
      createdByName: "manager",
      totalCostCents: 100 * 5000 + 40 * 5500, // 720 000
    });
    expect(order.lines.map((l) => [l.sku, l.orderedQty, l.receivedQty, l.unitCostCents])).toEqual([
      ["COM1-S", 100, 0, 5000],
      ["COM1-M", 40, 0, 5500],
    ]);
  });

  it("hides costs from callers that cannot see them", async () => {
    const w = await world();
    const { id } = await createPurchaseOrder(w.manager, orderInput(w), testDb);
    const order = (await getPurchaseOrder(id, { includeCost: false }, testDb))!;
    expect(order.totalCostCents).toBeNull();
    expect(order.lines.every((line) => line.unitCostCents === null)).toBe(true);
    const list = await listPurchaseOrders({ includeCost: false }, testDb);
    expect(list.rows[0]?.totalCostCents).toBeNull();
  });

  it("is only for roles that receive goods and see costs", async () => {
    const w = await world();
    for (const actor of [w.warehouse, w.cashier]) {
      await expect(createPurchaseOrder(actor, orderInput(w), testDb)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    }
  });

  it("rejects an unknown supplier, unknown variants, duplicates, bad numbers and empty orders", async () => {
    const w = await world();
    const bad: object[] = [
      orderInput(w, { supplierId: "no-existe" }),
      orderInput(w, { items: [{ variantId: "no-existe", orderedQty: 1, unitCostCents: 1 }] }),
      orderInput(w, {
        items: [
          { variantId: w.small.id, orderedQty: 1, unitCostCents: 1 },
          { variantId: w.small.id, orderedQty: 2, unitCostCents: 1 },
        ],
      }),
      orderInput(w, { items: [{ variantId: w.small.id, orderedQty: 0, unitCostCents: 1 }] }),
      orderInput(w, { items: [{ variantId: w.small.id, orderedQty: 1, unitCostCents: -1 }] }),
      orderInput(w, { items: [] }),
      orderInput(w, { supplierId: "" }),
    ];
    for (const input of bad) {
      await expect(
        createPurchaseOrder(w.manager, input, testDb),
        JSON.stringify(input),
      ).rejects.toBeInstanceOf(ValidationError);
    }
    expect(await testDb.purchaseOrder.count()).toBe(0);
  });

  it("does not order from an archived supplier or archived products", async () => {
    const w = await world();
    await testDb.supplier.update({
      where: { id: w.supplier.id },
      data: { archivedAt: new Date() },
    });
    await expect(createPurchaseOrder(w.manager, orderInput(w), testDb)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("edits only while it is a draft, replacing the lines", async () => {
    const w = await world();
    const { id } = await createPurchaseOrder(w.manager, orderInput(w), testDb);
    await updatePurchaseOrder(
      w.manager,
      id,
      orderInput(w, {
        expectedAt: "2026-12-01",
        items: [{ variantId: w.medium.id, orderedQty: 7, unitCostCents: 6000 }],
      }),
      testDb,
    );
    const order = (await getPurchaseOrder(id, { includeCost: true }, testDb))!;
    expect(order.expectedAt).toBe("2026-12-01");
    expect(order.lines.map((l) => [l.sku, l.orderedQty])).toEqual([["COM1-M", 7]]);

    await placePurchaseOrder(w.manager, id, testDb);
    await expect(updatePurchaseOrder(w.manager, id, orderInput(w), testDb)).rejects.toBeInstanceOf(
      OrderStateError,
    );
    await expect(
      updatePurchaseOrder(w.manager, "no-existe", orderInput(w), testDb),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("goes draft → ordered, and can be cancelled until something arrives", async () => {
    const w = await world();
    const a = await createPurchaseOrder(w.manager, orderInput(w), testDb);
    await placePurchaseOrder(w.manager, a.id, testDb);
    await expect(placePurchaseOrder(w.manager, a.id, testDb)).rejects.toBeInstanceOf(
      OrderStateError,
    );
    await cancelPurchaseOrder(w.manager, a.id, testDb);
    expect((await getPurchaseOrder(a.id, { includeCost: true }, testDb))!.status).toBe("CANCELLED");
    await expect(cancelPurchaseOrder(w.manager, a.id, testDb)).rejects.toBeInstanceOf(
      OrderStateError,
    );
    await expect(placePurchaseOrder(w.manager, "no-existe", testDb)).rejects.toBeInstanceOf(
      NotFoundError,
    );

    const b = await createPurchaseOrder(w.manager, orderInput(w), testDb);
    await placePurchaseOrder(w.manager, b.id, testDb);
    await receiveGoods(
      w.manager,
      { purchaseOrderId: b.id, items: [{ variantId: w.small.id, quantity: 10 }] },
      testDb,
    );
    await expect(cancelPurchaseOrder(w.manager, b.id, testDb)).rejects.toBeInstanceOf(
      OrderStateError,
    );
  });

  it("lists orders newest first, filtered by status", async () => {
    const w = await world();
    const a = await createPurchaseOrder(w.manager, orderInput(w), testDb);
    const b = await createPurchaseOrder(w.manager, orderInput(w), testDb);
    await placePurchaseOrder(w.manager, a.id, testDb);
    const all = await listPurchaseOrders({ includeCost: true }, testDb);
    expect(all.rows.map((r) => r.number)).toEqual([b.number, a.number]);
    const ordered = await listPurchaseOrders({ status: "ORDERED", includeCost: true }, testDb);
    expect(ordered.rows.map((r) => r.number)).toEqual([a.number]);
    expect(ordered.rows[0]).toMatchObject({ orderedUnits: 140, receivedUnits: 0 });
  });
});

describe("receiveGoods", () => {
  beforeEach(resetDatabase);

  it("receiving 100 garments updates stock, kardex and average cost with concrete numbers", async () => {
    const w = await world();
    // Ya hay 100 prendas que costaron L 40,00
    await testDb.variant.update({ where: { id: w.small.id }, data: { avgCostCents: 4000 } });
    await testDb.$transaction((tx) =>
      recordMovement(tx, {
        variantId: w.small.id,
        locationId: w.location.id,
        userId: w.owner.id,
        type: "INITIAL",
        quantity: 100,
        unitCostCents: 4000,
      }),
    );

    const receipt = await receiveGoods(
      w.manager,
      {
        supplierId: w.supplier.id,
        supplierInvoiceRef: "F-001-0042",
        items: [{ variantId: w.small.id, quantity: 100, unitCostCents: 5000 }],
      },
      testDb,
    );

    expect(receipt.number).toBe("RC-000001");
    expect(await onHand(w.small.id)).toBe(200);
    expect(await avgCost(w.small.id)).toBe(4500); // (100×4000 + 100×5000) ÷ 200
    const kardex = (await getKardex(w.small.id, {}, testDb))!;
    expect(kardex.rows[0]).toMatchObject({
      type: "PURCHASE_IN",
      quantity: 100,
      balance: 200,
      unitCostCents: 5000,
      document: { label: "RC-000001", href: `/compras/recepciones/${receipt.id}` },
    });
    expect(await findStockDiscrepancies(testDb)).toEqual([]);

    const detail = (await getReceipt(receipt.id, { includeCost: true }, testDb))!;
    expect(detail).toMatchObject({
      supplierName: "Textiles SA",
      supplierInvoiceRef: "F-001-0042",
      order: null,
      receivedByName: "manager",
      units: 100,
      totalCostCents: 500000,
    });
    const log = await testDb.auditLog.findFirstOrThrow({ where: { action: "GOODS_RECEIVED" } });
    expect(log.after).toMatchObject({ number: "RC-000001", units: 100, totalCostCents: 500000 });
  });

  it("receives an order in parts and closes it when everything arrived", async () => {
    const w = await world();
    const order = await createPurchaseOrder(w.manager, orderInput(w), testDb);
    await placePurchaseOrder(w.manager, order.id, testDb);

    await receiveGoods(
      w.manager,
      { purchaseOrderId: order.id, items: [{ variantId: w.small.id, quantity: 60 }] },
      testDb,
    );
    let detail = (await getPurchaseOrder(order.id, { includeCost: true }, testDb))!;
    expect(detail.status).toBe("PARTIALLY_RECEIVED");
    expect(detail.lines.map((l) => [l.sku, l.receivedQty])).toEqual([
      ["COM1-S", 60],
      ["COM1-M", 0],
    ]);
    expect(detail.receipts).toHaveLength(1);

    await receiveGoods(
      w.manager,
      {
        purchaseOrderId: order.id,
        items: [
          { variantId: w.small.id, quantity: 40 },
          { variantId: w.medium.id, quantity: 40 },
        ],
      },
      testDb,
    );
    detail = (await getPurchaseOrder(order.id, { includeCost: true }, testDb))!;
    expect(detail.status).toBe("RECEIVED");
    expect(detail.receipts.map((r) => r.number)).toEqual(["RC-000002", "RC-000001"]);
    expect(await onHand(w.small.id)).toBe(100);
    expect(await onHand(w.medium.id)).toBe(40);
    // El costo sale de la orden: 100 a L 50,00 → promedio L 50,00; 40 a L 55,00 → L 55,00
    expect(await avgCost(w.small.id)).toBe(5000);
    expect(await avgCost(w.medium.id)).toBe(5500);
  });

  it("does not accept more than is pending, nor lines outside the order, nor closed orders", async () => {
    const w = await world();
    const order = await createPurchaseOrder(w.manager, orderInput(w), testDb);

    await expect(
      receiveGoods(
        w.manager,
        { purchaseOrderId: order.id, items: [{ variantId: w.small.id, quantity: 1 }] },
        testDb,
      ),
    ).rejects.toBeInstanceOf(OrderStateError); // todavía es borrador

    await placePurchaseOrder(w.manager, order.id, testDb);
    await expect(
      receiveGoods(
        w.manager,
        { purchaseOrderId: order.id, items: [{ variantId: w.small.id, quantity: 101 }] },
        testDb,
      ),
    ).rejects.toBeInstanceOf(OverReceiptError);
    expect(await testDb.goodsReceipt.count()).toBe(0);
    expect(await testDb.stockMovement.count()).toBe(0);

    const other = await testDb.variant.create({
      data: {
        productId: (await testDb.product.findFirstOrThrow()).id,
        sku: "COM1-X",
        barcode: "9",
      },
    });
    await expect(
      receiveGoods(
        w.manager,
        { purchaseOrderId: order.id, items: [{ variantId: other.id, quantity: 1 }] },
        testDb,
      ),
    ).rejects.toBeInstanceOf(ValidationError);

    await cancelPurchaseOrder(w.manager, order.id, testDb);
    await expect(
      receiveGoods(
        w.manager,
        { purchaseOrderId: order.id, items: [{ variantId: w.small.id, quantity: 1 }] },
        testDb,
      ),
    ).rejects.toBeInstanceOf(OrderStateError);
    await expect(
      receiveGoods(
        w.manager,
        { purchaseOrderId: "no-existe", items: [{ variantId: w.small.id, quantity: 1 }] },
        testDb,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("two simultaneous receipts of the last pending units: exactly one succeeds", async () => {
    const w = await world();
    const order = await createPurchaseOrder(
      w.manager,
      orderInput(w, { items: [{ variantId: w.small.id, orderedQty: 10, unitCostCents: 5000 }] }),
      testDb,
    );
    await placePurchaseOrder(w.manager, order.id, testDb);

    const attempt = () =>
      receiveGoods(
        w.manager,
        { purchaseOrderId: order.id, items: [{ variantId: w.small.id, quantity: 10 }] },
        testDb,
      );
    const results = await Promise.allSettled([attempt(), attempt(), attempt()]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(failures).toHaveLength(2);
    for (const failure of failures) {
      expect([OverReceiptError, OrderStateError].some((E) => failure.reason instanceof E)).toBe(
        true,
      );
    }
    expect(await onHand(w.small.id)).toBe(10);
    expect(await testDb.goodsReceipt.count()).toBe(1);
    expect(await findStockDiscrepancies(testDb)).toEqual([]);
  });

  it("receives without an order, using the given cost", async () => {
    const w = await world();
    await receiveGoods(
      w.manager,
      {
        supplierId: w.supplier.id,
        items: [{ variantId: w.medium.id, quantity: 12, unitCostCents: 7000 }],
      },
      testDb,
    );
    expect(await onHand(w.medium.id)).toBe(12);
    expect(await avgCost(w.medium.id)).toBe(7000);
  });

  it("lets the warehouse receive, but never sets costs: uses the order's, or the current average", async () => {
    const w = await world();
    const order = await createPurchaseOrder(w.manager, orderInput(w), testDb);
    await placePurchaseOrder(w.manager, order.id, testDb);

    await receiveGoods(
      w.warehouse,
      {
        purchaseOrderId: order.id,
        items: [{ variantId: w.small.id, quantity: 10, unitCostCents: 1 }],
      },
      testDb,
    );
    expect(await avgCost(w.small.id)).toBe(5000); // el de la orden, no el que mandó

    await testDb.variant.update({ where: { id: w.medium.id }, data: { avgCostCents: 4200 } });
    await receiveGoods(
      w.warehouse,
      {
        supplierId: w.supplier.id,
        items: [{ variantId: w.medium.id, quantity: 5, unitCostCents: 1 }],
      },
      testDb,
    );
    const movement = await testDb.stockMovement.findFirstOrThrow({
      where: { variantId: w.medium.id, type: "PURCHASE_IN" },
    });
    expect(movement.unitCostCents).toBe(4200); // el costo promedio actual
    expect(await avgCost(w.medium.id)).toBe(4200);
  });

  it("falls back to the product base cost when the variant has no average yet", async () => {
    const w = await world();
    await receiveGoods(
      w.warehouse,
      { supplierId: w.supplier.id, items: [{ variantId: w.small.id, quantity: 2 }] },
      testDb,
    );
    const movement = await testDb.stockMovement.findFirstOrThrow({
      where: { type: "PURCHASE_IN" },
    });
    expect(movement.unitCostCents).toBe(3000); // baseCostCents del producto
  });

  it("refuses the cashier, bad input and archived suppliers or variants", async () => {
    const w = await world();
    const good = { supplierId: w.supplier.id, items: [{ variantId: w.small.id, quantity: 1 }] };
    await expect(receiveGoods(w.cashier, good, testDb)).rejects.toBeInstanceOf(ForbiddenError);
    const bad: object[] = [
      {},
      { items: good.items },
      { supplierId: w.supplier.id, items: [] },
      { supplierId: w.supplier.id, items: [{ variantId: w.small.id, quantity: 0 }] },
      { supplierId: w.supplier.id, items: [{ variantId: w.small.id, quantity: 1.5 }] },
      { supplierId: "no-existe", items: good.items },
      { supplierId: w.supplier.id, items: [{ variantId: "no-existe", quantity: 1 }] },
      {
        supplierId: w.supplier.id,
        items: [
          { variantId: w.small.id, quantity: 1 },
          { variantId: w.small.id, quantity: 1 },
        ],
      },
    ];
    for (const input of bad) {
      await expect(
        receiveGoods(w.manager, input, testDb),
        JSON.stringify(input),
      ).rejects.toBeInstanceOf(ValidationError);
    }
    await testDb.variant.update({ where: { id: w.small.id }, data: { archivedAt: new Date() } });
    await expect(receiveGoods(w.manager, good, testDb)).rejects.toBeInstanceOf(ValidationError);
    expect(await testDb.stockMovement.count()).toBe(0);
    expect(await testDb.goodsReceipt.count()).toBe(0);
  });

  it("assigns correlative receipt numbers and rolls the number back with a failed receipt", async () => {
    const w = await world();
    await expect(
      receiveGoods(
        w.manager,
        { supplierId: w.supplier.id, items: [{ variantId: "no-existe", quantity: 1 }] },
        testDb,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    const a = await receiveGoods(
      w.manager,
      { supplierId: w.supplier.id, items: [{ variantId: w.small.id, quantity: 1 }] },
      testDb,
    );
    const b = await receiveGoods(
      w.manager,
      { supplierId: w.supplier.id, items: [{ variantId: w.small.id, quantity: 1 }] },
      testDb,
    );
    expect([a.number, b.number]).toEqual(["RC-000001", "RC-000002"]);
  });
});

describe("receipt and variant queries", () => {
  beforeEach(resetDatabase);

  it("lists receipts with totals of everything that matches, filtered by supplier", async () => {
    const w = await world();
    const other = await testDb.supplier.create({ data: { name: "Otro SA" } });
    const receive = (supplierId: string, quantity: number, unitCostCents: number) =>
      receiveGoods(
        w.manager,
        { supplierId, items: [{ variantId: w.small.id, quantity, unitCostCents }] },
        testDb,
      );
    await receive(w.supplier.id, 10, 1000);
    await receive(w.supplier.id, 5, 2000);
    await receive(other.id, 1, 9000);

    const all = await listReceipts({ includeCost: true }, testDb);
    expect(all.total).toBe(3);
    expect(all.totals).toEqual({ units: 16, costCents: 10 * 1000 + 5 * 2000 + 9000 });
    expect(all.rows.map((r) => r.number)).toEqual(["RC-000003", "RC-000002", "RC-000001"]);

    const mine = await listReceipts({ supplierId: w.supplier.id, includeCost: true }, testDb);
    expect(mine.totals).toEqual({ units: 15, costCents: 20000 });
    expect(mine.rows.every((r) => r.supplierName === "Textiles SA")).toBe(true);

    const blind = await listReceipts({ includeCost: false }, testDb);
    expect(blind.totals.costCents).toBeNull();
    expect(blind.rows[0]?.totalCostCents).toBeNull();
  });

  it("finds variants by exact barcode, exact code or name, with costs only when allowed", async () => {
    const w = await world();
    await testDb.variant.update({ where: { id: w.small.id }, data: { avgCostCents: 4200 } });

    const byBarcode = await searchPurchasableVariants(
      "2000000000015",
      { includeCost: true },
      testDb,
    );
    expect(byBarcode).toEqual([
      expect.objectContaining({ variantId: w.small.id, exact: true, costCents: 4200, label: "S" }),
    ]);
    const bySku = await searchPurchasableVariants("com1-m", { includeCost: true }, testDb);
    expect(bySku.map((v) => [v.variantId, v.exact, v.costCents])).toEqual([
      [w.medium.id, true, 3000],
    ]);
    const byName = await searchPurchasableVariants("vestdio", { includeCost: false }, testDb);
    expect(byName.map((v) => v.sku)).toEqual(["COM1-M", "COM1-S"].sort());
    expect(byName.every((v) => !v.exact && v.costCents === null)).toBe(true);
    expect(await searchPurchasableVariants("   ", { includeCost: true }, testDb)).toEqual([]);
    expect(await searchPurchasableVariants("zapatos", { includeCost: true }, testDb)).toEqual([]);
  });
});
