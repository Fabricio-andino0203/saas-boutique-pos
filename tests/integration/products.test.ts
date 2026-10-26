import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { isValidEan13 } from "@/lib/barcode";
import {
  CodeTakenError,
  ForbiddenError,
  HasStockError,
  NameTakenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import type { Role } from "@/lib/permissions";
import { recordMovement } from "@/modules/inventory/service";
import { cellKey } from "@/modules/products/sku";
import {
  addVariants,
  bulkEditProducts,
  createProduct,
  duplicateProduct,
  getFormOptions,
  getProduct,
  listProducts,
  quickCreateOption,
  setProductArchived,
  setVariantArchived,
  updateProduct,
  updateVariant,
} from "@/modules/products/service";

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
  const women = await testDb.category.create({ data: { name: "Mujer", slug: "mujer" } });
  const dresses = await testDb.category.create({
    data: { name: "Vestidos", slug: "mujer-vestidos", parentId: women.id },
  });
  const men = await testDb.category.create({ data: { name: "Hombre", slug: "hombre" } });
  const brand = await testDb.brand.create({ data: { name: "Zara" } });
  const season = await testDb.season.create({ data: { name: "PV26" } });
  const supplier = await testDb.supplier.create({ data: { name: "Textiles SA" } });
  const [s, m, l] = await Promise.all(
    [
      ["S", 1],
      ["M", 2],
      ["L", 3],
    ].map(([name, sortOrder]) =>
      testDb.size.create({ data: { name: String(name), sortOrder: Number(sortOrder) } }),
    ),
  );
  const red = await testDb.color.create({ data: { name: "Rojo", hex: "#B42318", sortOrder: 1 } });
  const navy = await testDb.color.create({ data: { name: "Azul marino", sortOrder: 2 } });
  return {
    owner,
    manager,
    warehouse,
    cashier,
    location,
    women,
    dresses,
    men,
    brand,
    season,
    supplier,
    s: s!,
    m: m!,
    l: l!,
    red,
    navy,
  };
}

type World = Awaited<ReturnType<typeof world>>;

const base = (w: World, overrides: object = {}) => ({
  name: "Vestido floral",
  categoryId: w.women.id,
  basePriceCents: 100000,
  baseCostCents: 40000,
  code: "VES1",
  ...overrides,
});

async function onHand(variantId: string): Promise<number> {
  const rows = await testDb.stockLevel.findMany({ where: { variantId } });
  return rows.reduce((sum, row) => sum + row.onHand, 0);
}

describe("createProduct", () => {
  beforeEach(resetDatabase);
  afterAll(closeDatabase);

  it("builds the size × color matrix with unique SKUs and valid internal barcodes", async () => {
    const w = await world();
    const { id } = await createProduct(
      w.manager,
      base(w, { sizeIds: [w.s.id, w.m.id, w.l.id], colorIds: [w.red.id, w.navy.id] }),
      testDb,
    );

    const variants = await testDb.variant.findMany({ where: { productId: id } });
    expect(variants).toHaveLength(6);
    expect(variants.map((v) => v.sku).sort()).toEqual([
      "VES1-L-AZULMARINO",
      "VES1-L-ROJO",
      "VES1-M-AZULMARINO",
      "VES1-M-ROJO",
      "VES1-S-AZULMARINO",
      "VES1-S-ROJO",
    ]);
    expect(new Set(variants.map((v) => v.barcode)).size).toBe(6);
    for (const variant of variants) {
      expect(isValidEan13(variant.barcode), variant.barcode).toBe(true);
      expect(variant.barcode.startsWith("200")).toBe(true);
      expect(variant.avgCostCents).toBe(40000);
    }
  });

  it("records the initial quantities as INITIAL movements and in the running total", async () => {
    const w = await world();
    const { id } = await createProduct(
      w.manager,
      base(w, {
        sizeIds: [w.s.id, w.m.id],
        colorIds: [w.red.id],
        quantities: { [cellKey(w.s.id, w.red.id)]: 5, [cellKey(w.m.id, w.red.id)]: 0 },
      }),
      testDb,
    );
    const detail = (await getProduct(id, testDb))!;
    const small = detail.variants.find((v) => v.sizeName === "S")!;
    const medium = detail.variants.find((v) => v.sizeName === "M")!;
    expect(small.onHand).toBe(5);
    expect(medium.onHand).toBe(0);

    const movements = await testDb.stockMovement.findMany();
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      variantId: small.id,
      type: "INITIAL",
      quantity: 5,
      unitCostCents: 40000,
      userId: w.manager.id,
      locationId: w.location.id,
    });
  });

  it("creates one plain variant when there are no sizes or colors", async () => {
    const w = await world();
    const { id } = await createProduct(
      w.owner,
      base(w, { name: "Cinturón", code: "CIN1", quantities: { "-:-": 4 } }),
      testDb,
    );
    const detail = (await getProduct(id, testDb))!;
    expect(detail.variants).toHaveLength(1);
    expect(detail.variants[0]).toMatchObject({
      sku: "CIN1",
      sizeName: null,
      colorName: null,
      onHand: 4,
    });
  });

  it("assigns an automatic code when none is given", async () => {
    const w = await world();
    const { code } = await createProduct(w.owner, base(w, { code: "", sizeIds: [w.s.id] }), testDb);
    expect(code).toMatch(/^P\d{5}$/);
    const variant = await testDb.variant.findFirstOrThrow();
    expect(variant.sku).toBe(`${code}-S`);
  });

  it("logs the creation in the audit trail", async () => {
    const w = await world();
    const { id } = await createProduct(w.manager, base(w), testDb);
    const log = await testDb.auditLog.findFirstOrThrow({ where: { entityId: id } });
    expect(log).toMatchObject({ action: "PRODUCT_CREATED", userId: w.manager.id });
  });

  it("rejects a repeated code", async () => {
    const w = await world();
    await createProduct(w.owner, base(w), testDb);
    await expect(createProduct(w.owner, base(w), testDb)).rejects.toBeInstanceOf(CodeTakenError);
  });

  it("rejects unknown or archived references and leaves nothing behind", async () => {
    const w = await world();
    await testDb.brand.update({ where: { id: w.brand.id }, data: { archivedAt: new Date() } });
    await expect(
      createProduct(w.owner, base(w, { brandId: w.brand.id }), testDb),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createProduct(w.owner, base(w, { categoryId: "no-existe" }), testDb),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createProduct(w.owner, base(w, { sizeIds: [w.s.id, "no-existe"] }), testDb),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await testDb.product.count()).toBe(0);
    expect(await testDb.variant.count()).toBe(0);
  });

  it("rolls everything back when a step fails halfway", async () => {
    const w = await world();
    await testDb.location.deleteMany(); // sin ubicación no se puede cargar existencia
    await expect(
      createProduct(
        w.owner,
        base(w, { sizeIds: [w.s.id], quantities: { [cellKey(w.s.id, null)]: 3 } }),
        testDb,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await testDb.product.count()).toBe(0);
    expect(await testDb.variant.count()).toBe(0);
    expect(await testDb.auditLog.count()).toBe(0);
  });

  it("lets the warehouse create products but not the cashier", async () => {
    const w = await world();
    await expect(createProduct(w.warehouse, base(w), testDb)).resolves.toMatchObject({
      code: "VES1",
    });
    await expect(
      createProduct(w.cashier, base(w, { code: "VES2" }), testDb),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("updateProduct and price history", () => {
  beforeEach(resetDatabase);

  it("records price and cost changes in the history and the audit log", async () => {
    const w = await world();
    const { id } = await createProduct(w.manager, base(w), testDb);

    await updateProduct(
      w.manager,
      id,
      base(w, { basePriceCents: 120000, baseCostCents: 45000 }),
      testDb,
    );

    const history = await testDb.priceHistory.findMany({ where: { productId: id } });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      oldPriceCents: 100000,
      newPriceCents: 120000,
      oldCostCents: 40000,
      newCostCents: 45000,
      changedById: w.manager.id,
    });
    const actions = (await testDb.auditLog.findMany({ where: { entityId: id } }))
      .map((log) => log.action)
      .sort();
    expect(actions).toEqual(["COST_CHANGED", "PRICE_CHANGED", "PRODUCT_CREATED"]);
  });

  it("does not write history when price and cost stay the same", async () => {
    const w = await world();
    const { id } = await createProduct(w.manager, base(w), testDb);
    await updateProduct(w.manager, id, base(w, { name: "Vestido de flores" }), testDb);
    expect(await testDb.priceHistory.count()).toBe(0);
    const log = await testDb.auditLog.findFirstOrThrow({ where: { action: "PRODUCT_UPDATED" } });
    expect(log.before).toEqual({ name: "Vestido floral" });
    expect(log.after).toEqual({ name: "Vestido de flores" });
  });

  it("lets the warehouse rename but not change prices", async () => {
    const w = await world();
    const { id } = await createProduct(w.manager, base(w), testDb);

    await updateProduct(w.warehouse, id, base(w, { name: "Vestido largo" }), testDb);
    await expect(
      updateProduct(w.warehouse, id, base(w, { basePriceCents: 1 }), testDb),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      updateProduct(w.warehouse, id, base(w, { baseCostCents: 1 }), testDb),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const product = await testDb.product.findUniqueOrThrow({ where: { id } });
    expect(product).toMatchObject({ name: "Vestido largo", basePriceCents: 100000 });
  });

  it("reports unknown products and invalid data", async () => {
    const w = await world();
    await expect(updateProduct(w.owner, "no-existe", base(w), testDb)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const { id } = await createProduct(w.owner, base(w), testDb);
    await expect(updateProduct(w.owner, id, base(w, { name: "" }), testDb)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe("variants", () => {
  beforeEach(resetDatabase);

  it("stores a price override and compares it with the inherited price in the history", async () => {
    const w = await world();
    const { id } = await createProduct(w.manager, base(w, { sizeIds: [w.s.id] }), testDb);
    const variant = await testDb.variant.findFirstOrThrow({ where: { productId: id } });

    await updateVariant(
      w.manager,
      variant.id,
      { priceCents: 130000, costCents: null, reorderPoint: 2 },
      testDb,
    );

    const after = await testDb.variant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(after).toMatchObject({ priceCents: 130000, costCents: null, reorderPoint: 2 });
    const history = await testDb.priceHistory.findFirstOrThrow({
      where: { variantId: variant.id },
    });
    expect(history).toMatchObject({
      oldPriceCents: 100000, // heredaba el del producto
      newPriceCents: 130000,
      oldCostCents: 40000,
      newCostCents: 40000,
    });
  });

  it("lets the warehouse set the reorder point but not the price", async () => {
    const w = await world();
    const { id } = await createProduct(w.manager, base(w, { sizeIds: [w.s.id] }), testDb);
    const variant = await testDb.variant.findFirstOrThrow({ where: { productId: id } });

    await updateVariant(
      w.warehouse,
      variant.id,
      { priceCents: null, costCents: null, reorderPoint: 3 },
      testDb,
    );
    await expect(
      updateVariant(
        w.warehouse,
        variant.id,
        { priceCents: 5000, costCents: null, reorderPoint: 3 },
        testDb,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(
      (await testDb.variant.findUniqueOrThrow({ where: { id: variant.id } })).reorderPoint,
    ).toBe(3);
  });

  it("adds missing sizes and colors, skipping the ones that exist and restoring archived ones", async () => {
    const w = await world();
    const { id } = await createProduct(
      w.manager,
      base(w, { sizeIds: [w.s.id, w.m.id], colorIds: [w.red.id] }),
      testDb,
    );
    const medium = await testDb.variant.findFirstOrThrow({
      where: { productId: id, sizeId: w.m.id },
    });
    await setVariantArchived(w.manager, medium.id, true, testDb);

    const result = await addVariants(
      w.manager,
      id,
      {
        sizeIds: [w.s.id, w.m.id, w.l.id],
        colorIds: [w.red.id],
        quantities: { [cellKey(w.l.id, w.red.id)]: 6 },
      },
      testDb,
    );

    expect(result).toEqual({ created: 1, restored: 1 });
    const variants = await testDb.variant.findMany({ where: { productId: id } });
    expect(variants).toHaveLength(3);
    expect(variants.every((v) => v.archivedAt === null)).toBe(true);
    const large = variants.find((v) => v.sizeId === w.l.id)!;
    expect(large.sku).toBe("VES1-L-ROJO");
    expect(await onHand(large.id)).toBe(6);
  });

  it("does not add variants to an archived product", async () => {
    const w = await world();
    const { id } = await createProduct(w.manager, base(w), testDb);
    await setProductArchived(w.manager, id, true, testDb);
    await expect(addVariants(w.manager, id, { sizeIds: [w.s.id] }, testDb)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("archiving", () => {
  beforeEach(resetDatabase);

  it("blocks archiving while there is stock, then allows it and logs both directions", async () => {
    const w = await world();
    const { id } = await createProduct(
      w.manager,
      base(w, { sizeIds: [w.s.id], quantities: { [cellKey(w.s.id, null)]: 2 } }),
      testDb,
    );
    const variant = await testDb.variant.findFirstOrThrow({ where: { productId: id } });

    await expect(setProductArchived(w.manager, id, true, testDb)).rejects.toBeInstanceOf(
      HasStockError,
    );
    await expect(setVariantArchived(w.manager, variant.id, true, testDb)).rejects.toBeInstanceOf(
      HasStockError,
    );

    await testDb.$transaction((tx) =>
      recordMovement(tx, {
        variantId: variant.id,
        locationId: w.location.id,
        userId: w.manager.id,
        type: "ADJUSTMENT_OUT",
        quantity: -2,
      }),
    );
    await setProductArchived(w.manager, id, true, testDb);
    expect((await testDb.product.findUniqueOrThrow({ where: { id } })).archivedAt).not.toBeNull();
    await setProductArchived(w.manager, id, false, testDb);
    expect((await testDb.product.findUniqueOrThrow({ where: { id } })).archivedAt).toBeNull();

    const actions = (await testDb.auditLog.findMany({ where: { entityId: id } })).map(
      (l) => l.action,
    );
    expect(actions).toEqual(
      expect.arrayContaining(["PRODUCT_CREATED", "PRODUCT_ARCHIVED", "PRODUCT_RESTORED"]),
    );
  });

  it("refuses without permission and reports unknown ids", async () => {
    const w = await world();
    const { id } = await createProduct(w.manager, base(w), testDb);
    await expect(setProductArchived(w.cashier, id, true, testDb)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(setProductArchived(w.owner, "no-existe", true, testDb)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(setVariantArchived(w.owner, "no-existe", true, testDb)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("duplicateProduct", () => {
  beforeEach(resetDatabase);

  it("copies the data and the variants, with new codes and no stock", async () => {
    const w = await world();
    const { id } = await createProduct(
      w.manager,
      base(w, {
        brandId: w.brand.id,
        sizeIds: [w.s.id, w.m.id],
        colorIds: [w.red.id],
        quantities: { [cellKey(w.s.id, w.red.id)]: 4 },
      }),
      testDb,
    );
    const source = await testDb.variant.findFirstOrThrow({
      where: { productId: id, sizeId: w.s.id },
    });
    await testDb.variant.update({
      where: { id: source.id },
      data: { priceCents: 150000, reorderPoint: 2 },
    });

    const copy = await duplicateProduct(w.manager, id, testDb);

    expect(copy.id).not.toBe(id);
    expect(copy.code).toMatch(/^P\d{5}$/);
    const detail = (await getProduct(copy.id, testDb))!;
    expect(detail).toMatchObject({
      name: "Vestido floral (copia)",
      basePriceCents: 100000,
      baseCostCents: 40000,
      brandId: w.brand.id,
    });
    expect(detail.variants).toHaveLength(2);
    expect(detail.variants.every((v) => v.onHand === 0)).toBe(true);
    expect(detail.variants.map((v) => v.sku).sort()).toEqual([
      `${copy.code}-M-ROJO`,
      `${copy.code}-S-ROJO`,
    ]);
    const copiedSmall = detail.variants.find((v) => v.sizeName === "S")!;
    expect(copiedSmall).toMatchObject({ priceCents: 150000, reorderPoint: 2 });

    const barcodes = (await testDb.variant.findMany()).map((v) => v.barcode);
    expect(new Set(barcodes).size).toBe(4);
    expect(await testDb.stockMovement.count()).toBe(1); // solo el inicial del original
    await expect(duplicateProduct(w.owner, "no-existe", testDb)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("bulkEditProducts", () => {
  beforeEach(resetDatabase);

  async function two(w: World) {
    const a = await createProduct(
      w.manager,
      base(w, { code: "A1", name: "Blusa A", basePriceCents: 10000, sizeIds: [w.s.id, w.m.id] }),
      testDb,
    );
    const b = await createProduct(
      w.manager,
      base(w, { code: "B1", name: "Blusa B", basePriceCents: 5000, sizeIds: [w.s.id] }),
      testDb,
    );
    const override = await testDb.variant.findFirstOrThrow({
      where: { productId: a.id, sizeId: w.m.id },
    });
    await testDb.variant.update({ where: { id: override.id }, data: { priceCents: 12000 } });
    return { a: a.id, b: b.id, override: override.id };
  }

  it("raises prices by a percentage, including variants with their own price", async () => {
    const w = await world();
    const { a, b, override } = await two(w);

    const result = await bulkEditProducts(
      w.manager,
      { productIds: [a, b], price: { mode: "percent", bps: 1000 } },
      testDb,
    );

    expect(result).toEqual({ updated: 2 });
    expect((await testDb.product.findUniqueOrThrow({ where: { id: a } })).basePriceCents).toBe(
      11000,
    );
    expect((await testDb.product.findUniqueOrThrow({ where: { id: b } })).basePriceCents).toBe(
      5500,
    );
    expect((await testDb.variant.findUniqueOrThrow({ where: { id: override } })).priceCents).toBe(
      13200,
    );
    expect(await testDb.priceHistory.count({ where: { productId: a } })).toBe(1);
    expect(await testDb.priceHistory.count({ where: { variantId: override } })).toBe(1);
    expect(await testDb.auditLog.count({ where: { action: "PRICE_CHANGED" } })).toBe(2);
  });

  it("sets one price for everything and makes variants inherit again", async () => {
    const w = await world();
    const { a, override } = await two(w);

    await bulkEditProducts(
      w.manager,
      { productIds: [a], price: { mode: "set", cents: 9000 } },
      testDb,
    );

    expect((await testDb.product.findUniqueOrThrow({ where: { id: a } })).basePriceCents).toBe(
      9000,
    );
    expect(
      (await testDb.variant.findUniqueOrThrow({ where: { id: override } })).priceCents,
    ).toBeNull();
    const history = await testDb.priceHistory.findFirstOrThrow({ where: { variantId: override } });
    expect(history).toMatchObject({ oldPriceCents: 12000, newPriceCents: 9000 });
  });

  it("moves products to another category and season without touching prices", async () => {
    const w = await world();
    const { a, b } = await two(w);
    await bulkEditProducts(
      w.warehouse, // sin permiso de precios, pero sí de editar productos
      { productIds: [a, b], categoryId: w.dresses.id, seasonId: w.season.id },
      testDb,
    );
    for (const id of [a, b]) {
      expect(await testDb.product.findUniqueOrThrow({ where: { id } })).toMatchObject({
        categoryId: w.dresses.id,
        seasonId: w.season.id,
      });
    }
    expect(await testDb.priceHistory.count()).toBe(0);
  });

  it("refuses price changes without permission, and archived or unknown targets", async () => {
    const w = await world();
    const { a } = await two(w);
    await expect(
      bulkEditProducts(
        w.warehouse,
        { productIds: [a], price: { mode: "set", cents: 100 } },
        testDb,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      bulkEditProducts(w.cashier, { productIds: [a], categoryId: w.men.id }, testDb),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      bulkEditProducts(w.manager, { productIds: ["no-existe"], categoryId: w.men.id }, testDb),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      bulkEditProducts(w.manager, { productIds: [a], categoryId: "no-existe" }, testDb),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(bulkEditProducts(w.manager, { productIds: [a] }, testDb)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("refuses a discount that would leave a price below one centavo, changing nothing", async () => {
    const w = await world();
    const tiny = await createProduct(w.manager, base(w, { code: "T1", basePriceCents: 1 }), testDb);
    const { a } = await two(w);
    await expect(
      bulkEditProducts(
        w.manager,
        { productIds: [a, tiny.id], price: { mode: "percent", bps: -5000 } },
        testDb,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect((await testDb.product.findUniqueOrThrow({ where: { id: a } })).basePriceCents).toBe(
      10000,
    );
  });
});

describe("listProducts", () => {
  beforeEach(resetDatabase);

  async function catalog() {
    const w = await world();
    const make = (code: string, name: string, extra: object = {}) =>
      createProduct(w.manager, base(w, { code, name, ...extra }), testDb);
    const dress = await make("VES1", "Vestido floral", {
      brandId: w.brand.id,
      categoryId: w.dresses.id,
      sizeIds: [w.s.id],
      colorIds: [w.red.id],
      quantities: { [cellKey(w.s.id, w.red.id)]: 3 },
    });
    const nightgown = await make("CAM1", "Camisón de seda");
    const blouse = await make("BLU1", "Blusa azul", { categoryId: w.men.id });
    return { w, dress, nightgown, blouse };
  }

  const names = async (params: Parameters<typeof listProducts>[0]) =>
    (await listProducts(params, testDb)).rows.map((row) => row.name);

  it("lists active products by name with category, brand and stock", async () => {
    const { dress } = await catalog();
    const list = await listProducts({}, testDb);
    expect(list.rows.map((row) => row.name)).toEqual([
      "Blusa azul",
      "Camisón de seda",
      "Vestido floral",
    ]);
    expect(list.total).toBe(3);
    const row = list.rows.find((r) => r.id === dress.id)!;
    expect(row).toMatchObject({
      code: "VES1",
      categoryName: "Vestidos",
      brandName: "Zara",
      variantCount: 1,
      onHand: 3,
      lowStock: false,
      archived: false,
    });
  });

  it("finds products ignoring case, accents and small typos", async () => {
    await catalog();
    expect(await names({ q: "VESTIDO" })).toEqual(["Vestido floral"]);
    expect(await names({ q: "camison" })).toEqual(["Camisón de seda"]);
    expect(await names({ q: "vestdio" })).toEqual(["Vestido floral"]);
    expect(await names({ q: "zapatos" })).toEqual([]);
  });

  it("finds products by code, SKU, barcode, brand and category", async () => {
    const { dress } = await catalog();
    const barcode = (await testDb.variant.findFirstOrThrow({ where: { productId: dress.id } }))
      .barcode;
    expect(await names({ q: "ves1" })).toEqual(["Vestido floral"]);
    expect(await names({ q: "VES1-S" })).toEqual(["Vestido floral"]);
    expect(await names({ q: barcode })).toEqual(["Vestido floral"]);
    expect(await names({ q: "zara" })).toEqual(["Vestido floral"]);
    expect(await names({ q: "hombre" })).toEqual(["Blusa azul"]);
  });

  it("treats wildcard characters in the search as plain text", async () => {
    await catalog();
    expect(await names({ q: "%" })).toEqual([]);
    expect(await names({ q: "_" })).toEqual([]);
  });

  it("filters by category (including its subcategories), brand and status", async () => {
    const { w, nightgown } = await catalog();
    expect(await names({ categoryId: w.women.id })).toEqual(["Camisón de seda", "Vestido floral"]);
    expect(await names({ categoryId: w.dresses.id })).toEqual(["Vestido floral"]);
    expect(await names({ brandId: w.brand.id })).toEqual(["Vestido floral"]);

    await setProductArchived(w.manager, nightgown.id, true, testDb);
    expect(await names({})).not.toContain("Camisón de seda");
    expect(await names({ status: "archived" })).toEqual(["Camisón de seda"]);
    expect(await names({ status: "all" })).toHaveLength(3);
    expect(await names({ q: "camison", status: "archived" })).toEqual(["Camisón de seda"]);
    expect(await names({ q: "camison" })).toEqual([]);
  });

  it("flags low stock when a variant is at or under its reorder point", async () => {
    const { w, dress } = await catalog();
    const variant = await testDb.variant.findFirstOrThrow({ where: { productId: dress.id } });
    await updateVariant(
      w.manager,
      variant.id,
      { priceCents: null, costCents: null, reorderPoint: 3 },
      testDb,
    );
    const row = (await listProducts({}, testDb)).rows.find((r) => r.id === dress.id)!;
    expect(row.lowStock).toBe(true);
  });

  it("paginates at 25 per page", async () => {
    const w = await world();
    await testDb.product.createMany({
      data: Array.from({ length: 26 }, (_, index) => ({
        code: `PG${String(index).padStart(2, "0")}`,
        name: `Prenda ${String(index).padStart(2, "0")}`,
        categoryId: w.women.id,
        basePriceCents: 1000,
      })),
    });
    const first = await listProducts({ page: 1 }, testDb);
    const second = await listProducts({ page: 2 }, testDb);
    expect(first).toMatchObject({ total: 26, page: 1, pageSize: 25 });
    expect(first.rows).toHaveLength(25);
    expect(second.rows.map((row) => row.name)).toEqual(["Prenda 25"]);
    expect((await listProducts({ page: 0 }, testDb)).page).toBe(1);
  });
});

describe("getProduct and form options", () => {
  beforeEach(resetDatabase);

  it("returns null for unknown products and sorts variants by size then color", async () => {
    const w = await world();
    expect(await getProduct("no-existe", testDb)).toBeNull();
    const { id } = await createProduct(
      w.manager,
      base(w, { sizeIds: [w.l.id, w.s.id], colorIds: [w.navy.id, w.red.id] }),
      testDb,
    );
    const detail = (await getProduct(id, testDb))!;
    expect(detail.variants.map((v) => `${v.sizeName}-${v.colorName}`)).toEqual([
      "S-Rojo",
      "S-Azul marino",
      "L-Rojo",
      "L-Azul marino",
    ]);
  });

  it("lists active options with category paths, keeping archived ones the product still uses", async () => {
    const w = await world();
    const options = await getFormOptions({}, testDb);
    expect(options.categories.map((o) => o.label)).toEqual(["Hombre", "Mujer", "Mujer › Vestidos"]);
    expect(options.sizes.map((s) => s.name)).toEqual(["S", "M", "L"]);
    expect(options.colors.map((c) => c.name)).toEqual(["Rojo", "Azul marino"]);

    await testDb.category.update({ where: { id: w.men.id }, data: { archivedAt: new Date() } });
    await testDb.size.update({ where: { id: w.s.id }, data: { archivedAt: new Date() } });
    const hidden = await getFormOptions({}, testDb);
    expect(hidden.categories.map((o) => o.label)).not.toContain("Hombre");
    expect(hidden.sizes.map((s) => s.name)).toEqual(["M", "L"]);
    const kept = await getFormOptions({ categoryId: w.men.id }, testDb);
    expect(kept.categories.map((o) => o.label)).toContain("Hombre");
  });

  it("creates a size or color on the spot and rejects repeated names", async () => {
    const w = await world();
    const size = await quickCreateOption(w.warehouse, { entity: "sizes", name: " XL " }, testDb);
    expect(size).toMatchObject({ name: "XL", hex: null });
    const color = await quickCreateOption(w.warehouse, { entity: "colors", name: "Verde" }, testDb);
    expect(color.name).toBe("Verde");
    await expect(
      quickCreateOption(w.warehouse, { entity: "sizes", name: "XL" }, testDb),
    ).rejects.toBeInstanceOf(NameTakenError);
    await expect(
      quickCreateOption(w.cashier, { entity: "sizes", name: "XXL" }, testDb),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      quickCreateOption(w.owner, { entity: "brands", name: "X" }, testDb),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
