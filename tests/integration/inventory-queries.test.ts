import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { getKardex, KARDEX_PAGE_SIZE, listStock, stockStatus } from "@/modules/inventory/queries";

import { closeDatabase, resetDatabase, testDb } from "./helpers/db";

async function world() {
  const user = await testDb.user.create({
    data: { name: "Almacén", username: "almacen", passwordHash: "x", role: "WAREHOUSE" },
  });
  const location = await testDb.location.create({
    data: { code: "MAIN", name: "Tienda principal", isDefault: true },
  });
  const women = await testDb.category.create({ data: { name: "Mujer", slug: "mujer" } });
  const dresses = await testDb.category.create({
    data: { name: "Vestidos", slug: "mujer-vestidos", parentId: women.id },
  });
  const season = await testDb.season.create({ data: { name: "PV26" } });
  const [s, m] = await Promise.all([
    testDb.size.create({ data: { name: "S", sortOrder: 1 } }),
    testDb.size.create({ data: { name: "M", sortOrder: 2 } }),
  ]);
  const [red, blue] = await Promise.all([
    testDb.color.create({ data: { name: "Rojo", sortOrder: 1 } }),
    testDb.color.create({ data: { name: "Azul", sortOrder: 2 } }),
  ]);

  const dress = await testDb.product.create({
    data: {
      code: "VES1",
      name: "Vestido floral",
      categoryId: dresses.id,
      seasonId: season.id,
      basePriceCents: 100000,
    },
  });
  const variant = (sizeId: string, colorId: string, sku: string, extra: object = {}) =>
    testDb.variant.create({
      data: {
        productId: dress.id,
        sizeId,
        colorId,
        sku,
        barcode: `BAR-${sku}`,
        avgCostCents: 40000,
        ...extra,
      },
    });
  const sRed = await variant(s.id, red.id, "VES1-S-ROJO", { priceCents: 150000 });
  const mRed = await variant(m.id, red.id, "VES1-M-ROJO", { reorderPoint: 2 });
  const mBlue = await variant(m.id, blue.id, "VES1-M-AZUL");

  const blouse = await testDb.product.create({
    data: { code: "BLU1", name: "Blusa", categoryId: women.id, basePriceCents: 50000 },
  });
  const plain = await testDb.variant.create({
    data: { productId: blouse.id, sku: "BLU1", barcode: "BAR-BLU1", avgCostCents: 20000 },
  });

  const archived = await testDb.product.create({
    data: {
      code: "OLD1",
      name: "Archivada",
      categoryId: women.id,
      basePriceCents: 1000,
      archivedAt: new Date(),
    },
  });
  const oldVariant = await testDb.variant.create({
    data: { productId: archived.id, sku: "OLD1", barcode: "BAR-OLD1" },
  });

  const level = (variantId: string, onHand: number) =>
    testDb.stockLevel.create({ data: { variantId, locationId: location.id, onHand } });
  await level(sRed.id, 4);
  await level(mRed.id, 1);
  await level(oldVariant.id, 9);

  return { user, location, women, dresses, season, dress, blouse, sRed, mRed, mBlue, plain, level };
}

describe("stockStatus", () => {
  it("is out at zero or below, low at the reorder point or below, ok otherwise", () => {
    expect(stockStatus(0, null)).toBe("out");
    expect(stockStatus(-3, 5)).toBe("out");
    expect(stockStatus(1, null)).toBe("ok");
    expect(stockStatus(2, 2)).toBe("low");
    expect(stockStatus(1, 2)).toBe("low");
    expect(stockStatus(3, 2)).toBe("ok");
    expect(stockStatus(5, 0)).toBe("ok");
  });
});

describe("listStock", () => {
  beforeEach(resetDatabase);
  afterAll(closeDatabase);

  it("lists active products by name with their matrix, valuation and totals", async () => {
    await world();
    const list = await listStock({ includeCost: true }, testDb);

    expect(list.rows.map((row) => row.name)).toEqual(["Blusa", "Vestido floral"]);
    const dress = list.rows[1]!;
    expect(dress).toMatchObject({
      code: "VES1",
      categoryName: "Vestidos",
      variantCount: 3,
      onHand: 5,
      status: "low",
      hasLowVariant: true,
      // 4 × 400,00 + 1 × 400,00 + 0 × 400,00
      costValueCents: 200000,
      // 4 × 1 500,00 (precio propio) + 1 × 1 000,00 (el del producto)
      priceValueCents: 700000,
    });
    expect(dress.cells.map((cell) => [cell.sku, cell.onHand, cell.status])).toEqual([
      ["VES1-S-ROJO", 4, "ok"],
      ["VES1-M-ROJO", 1, "low"],
      ["VES1-M-AZUL", 0, "out"],
    ]);
    expect(list.rows[0]).toMatchObject({
      name: "Blusa",
      onHand: 0,
      status: "out",
      costValueCents: 0,
      priceValueCents: 0,
    });
    expect(list.totals).toEqual({
      products: 2,
      units: 5,
      costValueCents: 200000,
      priceValueCents: 700000,
    });
  });

  it("hides costs unless asked for them", async () => {
    await world();
    const list = await listStock({}, testDb);
    expect(list.rows.every((row) => row.costValueCents === null)).toBe(true);
    expect(list.totals.costValueCents).toBeNull();
  });

  it("does not value negative stock", async () => {
    const w = await world();
    await testDb.stockLevel.create({
      data: { variantId: w.plain.id, locationId: w.location.id, onHand: -3 },
    });
    const list = await listStock({ includeCost: true }, testDb);
    const blouse = list.rows.find((row) => row.name === "Blusa")!;
    expect(blouse).toMatchObject({
      onHand: -3,
      status: "out",
      costValueCents: 0,
      priceValueCents: 0,
    });
    expect(list.totals.units).toBe(5);
  });

  it("filters by stock state", async () => {
    await world();
    const names = async (filter: "all" | "low" | "out" | "in") =>
      (await listStock({ filter }, testDb)).rows.map((row) => row.name);
    expect(await names("all")).toEqual(["Blusa", "Vestido floral"]);
    expect(await names("low")).toEqual(["Vestido floral"]);
    expect(await names("out")).toEqual(["Blusa"]);
    expect(await names("in")).toEqual(["Vestido floral"]);
  });

  it("filters by category (with subcategories), season and search", async () => {
    const w = await world();
    const names = async (params: Parameters<typeof listStock>[0]) =>
      (await listStock(params, testDb)).rows.map((row) => row.name);
    expect(await names({ categoryId: w.women.id })).toEqual(["Blusa", "Vestido floral"]);
    expect(await names({ categoryId: w.dresses.id })).toEqual(["Vestido floral"]);
    expect(await names({ seasonId: w.season.id })).toEqual(["Vestido floral"]);
    expect(await names({ q: "vestdio" })).toEqual(["Vestido floral"]);
    expect(await names({ q: "BAR-BLU1" })).toEqual(["Blusa"]);
    expect(await names({ q: "zapatos" })).toEqual([]);
  });

  it("combines the state filter with totals of what is shown", async () => {
    await world();
    const list = await listStock({ filter: "in", includeCost: true }, testDb);
    expect(list.totals).toEqual({
      products: 1,
      units: 5,
      costValueCents: 200000,
      priceValueCents: 700000,
    });
  });

  it("paginates at 25 per page", async () => {
    const w = await world();
    await testDb.product.createMany({
      data: Array.from({ length: 24 }, (_, i) => ({
        code: `PG${i}`,
        name: `Prenda ${String(i).padStart(2, "0")}`,
        categoryId: w.women.id,
        basePriceCents: 1000,
      })),
    });
    const first = await listStock({ page: 1 }, testDb);
    const second = await listStock({ page: 2 }, testDb);
    expect(first).toMatchObject({ total: 26, page: 1, pageSize: 25 });
    expect(first.rows).toHaveLength(25);
    expect(second.rows).toHaveLength(1);
    expect(first.totals.products).toBe(26);
  });
});

describe("getKardex", () => {
  beforeEach(resetDatabase);

  const at = (minutes: number) => new Date(Date.UTC(2026, 9, 1, 12, minutes));

  it("lists movements newest first with the balance after each one", async () => {
    const w = await world();
    const base = { variantId: w.sRed.id, locationId: w.location.id, userId: w.user.id };
    const goodsReceipt = await testDb.goodsReceipt.create({
      data: {
        number: "RC-000001",
        supplierId: (await testDb.supplier.create({ data: { name: "Textiles SA" } })).id,
        locationId: w.location.id,
        receivedById: w.user.id,
      },
    });
    await testDb.stockMovement.createMany({
      data: [
        {
          ...base,
          type: "INITIAL",
          quantity: 10,
          unitCostCents: 40000,
          createdAt: at(0),
          refType: "Product",
          refId: w.dress.id,
        },
        {
          ...base,
          type: "SALE_OUT",
          quantity: -3,
          unitCostCents: 40000,
          createdAt: at(1),
          refType: "Sale",
          refId: "venta-1",
        },
        { ...base, type: "LAYAWAY_RESERVE", quantity: 1, createdAt: at(2) },
        {
          ...base,
          type: "PURCHASE_IN",
          quantity: 5,
          unitCostCents: 41000,
          createdAt: at(3),
          refType: "GoodsReceipt",
          refId: goodsReceipt.id,
        },
        { ...base, type: "ADJUSTMENT_OUT", quantity: -1, createdAt: at(4), reason: "Daño" },
      ],
    });

    const kardex = (await getKardex(w.sRed.id, {}, testDb))!;

    expect(kardex.header).toMatchObject({
      productName: "Vestido floral",
      productCode: "VES1",
      sku: "VES1-S-ROJO",
      barcode: "BAR-VES1-S-ROJO",
      sizeName: "S",
      colorName: "Rojo",
      onHand: 4,
      avgCostCents: 40000,
    });
    expect(kardex.total).toBe(5);
    expect(kardex.rows.map((row) => [row.type, row.quantity, row.balance])).toEqual([
      ["ADJUSTMENT_OUT", -1, 11], // 10 − 3 + 5 − 1 (la reserva no cuenta)
      ["PURCHASE_IN", 5, 12],
      ["LAYAWAY_RESERVE", 1, 7],
      ["SALE_OUT", -3, 7],
      ["INITIAL", 10, 10],
    ]);
    expect(kardex.rows[0]).toMatchObject({ reason: "Daño", userName: "Almacén", document: null });
    expect(kardex.rows[1]?.document).toEqual({
      label: "RC-000001",
      href: `/compras/recepciones/${goodsReceipt.id}`,
    });
    expect(kardex.rows[3]?.document).toEqual({ label: "Sale", href: null });
    expect(kardex.rows[4]?.document).toEqual({ label: "VES1", href: `/productos/${w.dress.id}` });
  });

  it("pages through long histories keeping the running balance", async () => {
    const w = await world();
    await testDb.stockMovement.createMany({
      data: Array.from({ length: KARDEX_PAGE_SIZE + 5 }, (_, i) => ({
        variantId: w.mBlue.id,
        locationId: w.location.id,
        userId: w.user.id,
        type: "ADJUSTMENT_IN" as const,
        quantity: 1,
        createdAt: at(i),
      })),
    });
    const first = (await getKardex(w.mBlue.id, { page: 1 }, testDb))!;
    const second = (await getKardex(w.mBlue.id, { page: 2 }, testDb))!;
    expect(first.total).toBe(KARDEX_PAGE_SIZE + 5);
    expect(first.rows).toHaveLength(KARDEX_PAGE_SIZE);
    expect(first.rows[0]?.balance).toBe(KARDEX_PAGE_SIZE + 5);
    expect(second.rows.map((row) => row.balance)).toEqual([5, 4, 3, 2, 1]);
  });

  it("returns an empty history for a variant without movements, and null for an unknown one", async () => {
    const w = await world();
    const kardex = (await getKardex(w.mBlue.id, {}, testDb))!;
    expect(kardex.rows).toEqual([]);
    expect(kardex.total).toBe(0);
    expect(await getKardex("no-existe", {}, testDb)).toBeNull();
  });
});
