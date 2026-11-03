import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { isValidEan13 } from "@/lib/barcode";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import type { Role } from "@/lib/permissions";
import { DEFAULT_LABEL_TEMPLATE } from "@/lib/settings";
import { listReorderAlerts } from "@/modules/inventory/reorder";
import { recordMovement } from "@/modules/inventory/service";
import {
  buildLabels,
  getLabelSelection,
  getLabelTemplate,
  getProductLabelRows,
  isLabelQuantityMode,
  MAX_LABELS,
  saveLabelTemplate,
  searchLabelProducts,
  withStock,
} from "@/modules/labels/service";
import { createProduct } from "@/modules/products/service";
import {
  createPurchaseOrder,
  placePurchaseOrder,
  receiveGoods,
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
  const warehouse = await make("warehouse", "WAREHOUSE");
  const cashier = await make("cashier", "CASHIER");
  const location = await testDb.location.create({
    data: { code: "MAIN", name: "Tienda principal", isDefault: true },
  });
  const category = await testDb.category.create({ data: { name: "Mujer", slug: "mujer" } });
  const supplier = await testDb.supplier.create({ data: { name: "Textiles SA" } });
  const sizes = await Promise.all(
    ["S", "M", "L"].map((name, index) => testDb.size.create({ data: { name, sortOrder: index } })),
  );
  const colors = await Promise.all(
    ["Rojo", "Azul"].map((name, index) =>
      testDb.color.create({ data: { name, sortOrder: index } }),
    ),
  );
  return { owner, warehouse, cashier, location, category, supplier, sizes, colors };
}

type World = Awaited<ReturnType<typeof world>>;

const stock = (w: World, variantId: string, quantity: number) =>
  testDb.$transaction((tx) =>
    recordMovement(tx, {
      variantId,
      locationId: w.location.id,
      userId: w.owner.id,
      type: "INITIAL",
      quantity,
    }),
  );

async function plainVariant(w: World, code: string, name: string, reorderPoint: number | null) {
  const product = await testDb.product.create({
    data: { code, name, categoryId: w.category.id, basePriceCents: 10000 },
  });
  return testDb.variant.create({
    data: { productId: product.id, sku: code, barcode: `B-${code}`, reorderPoint },
  });
}

describe("listReorderAlerts", () => {
  beforeEach(resetDatabase);
  afterAll(closeDatabase);

  it("lists variants at or below their minimum, the most missing first", async () => {
    const w = await world();
    const a = await plainVariant(w, "A1", "Blusa", 5);
    const b = await plainVariant(w, "B1", "Camisa", 3);
    const c = await plainVariant(w, "C1", "Falda", 2);
    await plainVariant(w, "D1", "Sin mínimo", null); // sin mínimo configurado: no avisa
    const e = await plainVariant(w, "E1", "Holgada", 1);
    await stock(w, a.id, 1); // faltan 4
    await stock(w, b.id, 3); // justo en el mínimo: faltan 0
    await stock(w, c.id, 5); // de sobra
    // e: sin ninguna existencia, mínimo 1: faltan 1

    const alerts = await listReorderAlerts(testDb);

    expect(alerts.map((x) => [x.sku, x.onHand, x.reorderPoint, x.missing])).toEqual([
      ["A1", 1, 5, 4],
      ["E1", 0, 1, 1],
      ["B1", 3, 3, 0],
    ]);
    expect(alerts[0]).toMatchObject({ productName: "Blusa", label: "", onHand: 1 });
    expect(e.id).toBeDefined();
  });

  it("ignores archived products and variants", async () => {
    const w = await world();
    const a = await plainVariant(w, "A1", "Blusa", 5);
    const b = await plainVariant(w, "B1", "Camisa", 5);
    await testDb.variant.update({ where: { id: a.id }, data: { archivedAt: new Date() } });
    await testDb.product.update({ where: { id: b.productId }, data: { archivedAt: new Date() } });
    expect(await listReorderAlerts(testDb)).toEqual([]);
  });

  it("adds what is already on order and not yet received", async () => {
    const w = await world();
    const a = await plainVariant(w, "A1", "Blusa", 5);
    const order = await createPurchaseOrder(
      w.owner,
      {
        supplierId: w.supplier.id,
        items: [{ variantId: a.id, orderedQty: 20, unitCostCents: 1000 }],
      },
      testDb,
    );
    expect((await listReorderAlerts(testDb))[0]?.onOrder).toBe(0); // borrador: todavía no cuenta

    await placePurchaseOrder(w.owner, order.id, testDb);
    expect((await listReorderAlerts(testDb))[0]?.onOrder).toBe(20);

    await receiveGoods(
      w.owner,
      { purchaseOrderId: order.id, items: [{ variantId: a.id, quantity: 4 }] },
      testDb,
    );
    const [alert] = await listReorderAlerts(testDb);
    expect(alert).toMatchObject({ onHand: 4, missing: 1, onOrder: 16 });

    await receiveGoods(
      w.owner,
      { purchaseOrderId: order.id, items: [{ variantId: a.id, quantity: 16 }] },
      testDb,
    );
    expect(await listReorderAlerts(testDb)).toEqual([]); // 20 en existencia, mínimo 5
  });
});

describe("label template", () => {
  beforeEach(resetDatabase);

  it("starts with the default and keeps what is saved, auditing the change", async () => {
    const w = await world();
    expect(await getLabelTemplate(testDb)).toEqual(DEFAULT_LABEL_TEMPLATE);

    const saved = await saveLabelTemplate(
      w.warehouse,
      { ...DEFAULT_LABEL_TEMPLATE, layout: "sheet", widthMm: 60, heightMm: 35, showSku: false },
      testDb,
    );
    expect(saved).toMatchObject({ layout: "sheet", widthMm: 60, showSku: false });
    expect(await getLabelTemplate(testDb)).toEqual(saved);
    const log = await testDb.auditLog.findFirstOrThrow({ where: { action: "SETTINGS_CHANGED" } });
    expect(log).toMatchObject({ entityId: "labels.template", userId: w.warehouse.id });

    await saveLabelTemplate(w.warehouse, saved, testDb); // sin cambios: no audita otra vez
    expect(await testDb.auditLog.count()).toBe(1);
  });

  it("rejects invalid templates and the cashier", async () => {
    const w = await world();
    await expect(
      saveLabelTemplate(w.owner, { ...DEFAULT_LABEL_TEMPLATE, widthMm: 5 }, testDb),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(saveLabelTemplate(w.owner, { layout: "roll" }, testDb)).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      saveLabelTemplate(w.cashier, DEFAULT_LABEL_TEMPLATE, testDb),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await getLabelTemplate(testDb)).toEqual(DEFAULT_LABEL_TEMPLATE);
  });
});

describe("buildLabels", () => {
  beforeEach(resetDatabase);

  async function thirtyVariants(w: World) {
    const { id } = await createProduct(
      w.owner,
      {
        name: "Vestido floral",
        categoryId: w.category.id,
        basePriceCents: 85000,
        code: "ETI1",
        sizeIds: w.sizes.map((s) => s.id),
        colorIds: w.colors.map((c) => c.id),
      },
      testDb,
    );
    const variants = await testDb.variant.findMany({ where: { productId: id } });
    // 6 de las 30 etiquetas pedidas se repiten para que lleguen a 30 con 6 variantes: 5 de cada una
    return variants.map((variant) => ({ variantId: variant.id, quantity: 5 }));
  }

  it("makes one label per unit with a scannable barcode, 30 labels in under 2 seconds", async () => {
    const w = await world();
    const items = await thirtyVariants(w);

    const started = Date.now();
    const labels = await buildLabels(items, testDb);
    const elapsed = Date.now() - started;

    expect(labels).toHaveLength(30);
    expect(elapsed).toBeLessThan(2000);
    for (const label of labels) {
      expect(isValidEan13(label.barcode), label.barcode).toBe(true); // EAN-13 interno
      expect(label.svg.startsWith("<svg")).toBe(true);
      expect(label.svg).toContain("<path");
      expect(label.priceCents).toBe(85000);
      expect(label.productName).toBe("Vestido floral");
    }
    expect(new Set(labels.map((l) => l.barcode)).size).toBe(6);
    expect(new Set(labels.map((l) => l.variantLabel)).size).toBe(6);
  });

  it("uses the variant's own price when it has one, and Code 128 for non-EAN codes", async () => {
    const w = await world();
    const v = await plainVariant(w, "ZZ9", "Cinturón", null);
    await testDb.variant.update({ where: { id: v.id }, data: { priceCents: 31000 } });
    const [label] = await buildLabels([{ variantId: v.id, quantity: 1 }], testDb);
    expect(label).toMatchObject({ priceCents: 31000, barcode: "B-ZZ9", sku: "ZZ9" });
    expect(label?.svg.startsWith("<svg")).toBe(true);
  });

  it("rejects bad quantities, unknown variants, empty lists and mountains of labels", async () => {
    const w = await world();
    const v = await plainVariant(w, "ZZ9", "Cinturón", null);
    for (const items of [
      [],
      [{ variantId: v.id, quantity: 0 }],
      [{ variantId: v.id, quantity: 1.5 }],
      [{ variantId: v.id, quantity: -1 }],
      [{ variantId: "no-existe", quantity: 1 }],
      [{ variantId: v.id, quantity: MAX_LABELS + 1 }],
      [
        { variantId: v.id, quantity: MAX_LABELS },
        { variantId: v.id, quantity: 1 },
      ],
    ]) {
      await expect(buildLabels(items, testDb), JSON.stringify(items)).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
    await expect(
      buildLabels([{ variantId: v.id, quantity: MAX_LABELS }], testDb),
    ).resolves.toHaveLength(MAX_LABELS);
  });
});

describe("getLabelSelection", () => {
  beforeEach(resetDatabase);

  it("starts from the variants of a product, or from what a receipt brought in", async () => {
    const w = await world();
    const { id } = await createProduct(
      w.owner,
      {
        name: "Vestido",
        categoryId: w.category.id,
        basePriceCents: 1000,
        code: "SEL1",
        sizeIds: w.sizes.slice(0, 2).map((s) => s.id),
      },
      testDb,
    );
    const byProduct = await getLabelSelection({ productIds: [id] }, testDb);
    expect(byProduct.map((r) => [r.sku, r.label, r.quantity])).toEqual([
      ["SEL1-M", "M", 1],
      ["SEL1-S", "S", 1],
    ]);

    const variants = await testDb.variant.findMany({
      where: { productId: id },
      orderBy: { sku: "asc" },
    });
    const receipt = await receiveGoods(
      w.owner,
      {
        supplierId: w.supplier.id,
        items: [
          { variantId: variants[0]!.id, quantity: 7 },
          { variantId: variants[1]!.id, quantity: 3 },
        ],
      },
      testDb,
    );
    const byReceipt = await getLabelSelection({ receiptId: receipt.id }, testDb);
    expect(byReceipt.map((r) => r.quantity).sort()).toEqual([3, 7]);

    expect(await getLabelSelection({}, testDb)).toEqual([]);
  });
});

describe("labels of one product, adjusted to the stock (optional)", () => {
  beforeEach(resetDatabase);

  async function product(w: World, code: string, name: string, quantities: number[]) {
    const { id } = await createProduct(
      w.owner,
      {
        name,
        categoryId: w.category.id,
        basePriceCents: 1000,
        code,
        sizeIds: w.sizes.slice(0, quantities.length).map((s) => s.id),
      },
      testDb,
    );
    const variants = await testDb.variant.findMany({
      where: { productId: id },
      orderBy: { sku: "asc" },
    });
    for (const [index, variant] of variants.entries()) {
      if ((quantities[index] ?? 0) > 0) {
        await stock(w, variant.id, quantities[index] as number);
      }
    }
    return { id, variants };
  }

  it("asks for one label of each garment by default and shows how many there are", async () => {
    const w = await world();
    const { id } = await product(w, "STK1", "Vestido", [8, 0]);
    const rows = await getLabelSelection({ productIds: [id] }, testDb);
    // Las prendas salen ordenadas por código (M antes que S); el stock se repartió en ese mismo orden: M tiene 8 y S ninguna.
    expect(rows.map((row) => [row.label, row.quantity, row.onHand])).toEqual([
      ["M", 1, 8],
      ["S", 1, 0],
    ]);
  });

  it("asks for as many labels as the stock when that option is chosen, and none for what is out of stock", async () => {
    const w = await world();
    const { id } = await product(w, "STK2", "Blusa", [8, 0]);
    const rows = await getLabelSelection({ productIds: [id], quantity: "stock" }, testDb);
    expect(rows.map((row) => [row.label, row.quantity, row.onHand])).toEqual([
      ["M", 8, 8],
      ["S", 0, 0],
    ]);
  });

  it("adds up every location's stock", async () => {
    const w = await world();
    const { id, variants } = await product(w, "STK3", "Falda", [5]);
    const other = await testDb.location.create({ data: { code: "BOD", name: "Bodega" } });
    await testDb.$transaction((tx) =>
      recordMovement(tx, {
        variantId: variants[0]!.id,
        locationId: other.id,
        userId: w.owner.id,
        type: "INITIAL",
        quantity: 4,
      }),
    );
    const rows = await getLabelSelection({ productIds: [id], quantity: "stock" }, testDb);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ onHand: 9, quantity: 9 });
  });

  it("keeps what a receipt brought in as the quantity and still shows the stock", async () => {
    const w = await world();
    const { variants } = await product(w, "STK4", "Chaqueta", [6]);
    const receipt = await receiveGoods(
      w.owner,
      { supplierId: w.supplier.id, items: [{ variantId: variants[0]!.id, quantity: 2 }] },
      testDb,
    );
    const rows = await getLabelSelection({ receiptId: receipt.id, quantity: "stock" }, testDb);
    expect(rows.map((row) => [row.quantity, row.onHand])).toEqual([[2, 8]]);
  });

  it("gives every option of the garment search its stock", async () => {
    const w = await world();
    const { variants } = await product(w, "STK5", "Pantalón", [3]);
    const options = [
      {
        variantId: variants[0]!.id,
        productName: "Pantalón",
        label: "S",
        sku: variants[0]!.sku,
        barcode: variants[0]!.barcode,
        costCents: null,
        exact: false,
        imageId: null,
      },
    ];
    const withStocks = await withStock(options, testDb);
    expect(withStocks[0]).toMatchObject({ variantId: variants[0]!.id, onHand: 3 });
    expect(await withStock([], testDb)).toEqual([]);
  });

  it("finds products to take all their garments, and leaves out archived ones and the ones without garments", async () => {
    const w = await world();
    const vestido = await product(w, "STK6", "Vestido floral", [4, 6]);
    const archived = await product(w, "STK7", "Vestido viejo", [1]);
    await testDb.product.update({ where: { id: archived.id }, data: { archivedAt: new Date() } });
    const bare = await testDb.product.create({
      data: {
        code: "STK8",
        name: "Vestido sin tallas",
        categoryId: w.category.id,
        basePriceCents: 100,
      },
    });

    const found = await searchLabelProducts("Vestido", testDb);
    expect(found.map((row) => row.id)).toEqual([vestido.id]);
    expect(found[0]).toMatchObject({ code: "STK6", variantCount: 2, onHand: 10 });
    expect(found.some((row) => row.id === bare.id)).toBe(false);
    expect(await searchLabelProducts("   ", testDb)).toEqual([]);
    expect(await searchLabelProducts("zzzz-nada", testDb)).toEqual([]);
  });

  it("takes all the garments of one product with the chosen quantity", async () => {
    const w = await world();
    const { id } = await product(w, "STK9", "Abrigo", [2, 3]);
    const oneEach = await getProductLabelRows(id, "one", testDb);
    expect(oneEach.map((row) => row.quantity)).toEqual([1, 1]);
    const toStock = await getProductLabelRows(id, "stock", testDb);
    expect(toStock.map((row) => [row.quantity, row.onHand]).sort()).toEqual([
      [2, 2],
      [3, 3],
    ]);
    expect(isLabelQuantityMode("stock")).toBe(true);
    expect(isLabelQuantityMode("todo")).toBe(false);
  });
});
