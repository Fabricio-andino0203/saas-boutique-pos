import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import type { Role } from "@/lib/permissions";
import { quickCustomer } from "@/modules/customers/service";
import { recordMovement } from "@/modules/inventory/service";
import { listPosCategories, lookupCode, searchSellable } from "@/modules/sales/pos-queries";

import { closeDatabase, resetDatabase, testDb } from "./helpers/db";

const closeAll = async () => {
  await db.$disconnect();
  await closeDatabase();
};

type Actor = { id: string; role: Role };

async function world() {
  const make = async (username: string, role: Role): Promise<Actor> => {
    const user = await testDb.user.create({
      data: { name: username, username, passwordHash: "x", role },
    });
    return { id: user.id, role };
  };
  const owner = await make("owner", "OWNER");
  const cashier = await make("cashier", "CASHIER");
  const warehouse = await make("warehouse", "WAREHOUSE");
  const location = await testDb.location.create({
    data: { code: "MAIN", name: "Tienda principal", isDefault: true },
  });
  const women = await testDb.category.create({ data: { name: "Mujer", slug: "mujer" } });
  const dresses = await testDb.category.create({
    data: { name: "Vestidos", slug: "mujer-vestidos", parentId: women.id },
  });
  const men = await testDb.category.create({ data: { name: "Hombre", slug: "hombre" } });
  const old = await testDb.category.create({
    data: { name: "Antigua", slug: "antigua", archivedAt: new Date() },
  });
  const [sizeS, sizeM] = await Promise.all(
    ["S", "M"].map((name, index) => testDb.size.create({ data: { name, sortOrder: index + 1 } })),
  );
  const red = await testDb.color.create({ data: { name: "Rojo", hex: "#cc0000" } });
  const blue = await testDb.color.create({ data: { name: "Azul", hex: "#0000cc" } });

  const product = (
    code: string,
    name: string,
    categoryId: string,
    extra: { basePriceCents?: number; taxCategory?: "STANDARD" | "EXEMPT"; archivedAt?: Date } = {},
  ) =>
    testDb.product.create({
      data: { code, name, categoryId, basePriceCents: 11500, ...extra },
    });
  const variant = (
    productId: string,
    sku: string,
    barcode: string,
    extra: {
      sizeId?: string;
      colorId?: string;
      priceCents?: number;
      archivedAt?: Date;
    } = {},
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

  const dress = await product("VES1", "Vestido floral", dresses.id);
  const blouse = await product("BLU1", "Blusa de lino", women.id);
  const shirt = await product("CAM1", "Camisa Oxford", men.id, { taxCategory: "EXEMPT" });
  const retired = await product("OLD1", "Vieja", women.id, { archivedAt: new Date() });

  const dressS = await variant(dress.id, "VES1-S", "7001", { sizeId: sizeS!.id, colorId: red.id });
  const dressM = await variant(dress.id, "VES1-M", "7002", {
    sizeId: sizeM!.id,
    colorId: blue.id,
    priceCents: 12500,
  });
  const dressOld = await variant(dress.id, "VES1-X", "7009", { archivedAt: new Date() });
  const blouseV = await variant(blouse.id, "BLU1", "7003");
  const shirtV = await variant(shirt.id, "CAM1", "7004");
  await variant(retired.id, "OLD1", "7006");
  await stock(dressS.id, 5);
  await stock(dressOld.id, 9);
  await stock(blouseV.id, 3);

  return {
    owner,
    cashier,
    warehouse,
    women,
    dresses,
    men,
    old,
    dress,
    dressS,
    dressM,
    blouseV,
    shirtV,
  };
}

describe("searchSellable", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("lists the sellable products by name, without archived ones", async () => {
    await world();
    const found = await searchSellable({}, testDb);
    expect(found.map((p) => p.name)).toEqual(["Blusa de lino", "Camisa Oxford", "Vestido floral"]);
  });

  it("describes each variant: size, color, price, stock and exemption", async () => {
    const w = await world();
    const [dress] = await searchSellable({ q: "vestido" }, testDb);
    expect(dress).toMatchObject({
      productId: w.dress.id,
      code: "VES1",
      name: "Vestido floral",
      categoryName: "Vestidos",
    });
    // La variante archivada no aparece; el precio propio de la M manda sobre el del producto
    expect(dress?.variants).toEqual([
      {
        variantId: w.dressS.id,
        sku: "VES1-S",
        barcode: "7001",
        sizeName: "S",
        colorName: "Rojo",
        colorHex: "#cc0000",
        priceCents: 11500,
        onHand: 5,
        taxExempt: false,
      },
      {
        variantId: w.dressM.id,
        sku: "VES1-M",
        barcode: "7002",
        sizeName: "M",
        colorName: "Azul",
        colorHex: "#0000cc",
        priceCents: 12500,
        onHand: 0,
        taxExempt: false,
      },
    ]);
    const [shirt] = await searchSellable({ q: "camisa" }, testDb);
    expect(shirt?.variants[0]).toMatchObject({ taxExempt: true, onHand: 0 });
  });

  it("finds by name, color, sku, barcode and product code, in any order of the words", async () => {
    await world();
    const names = async (q: string) => (await searchSellable({ q }, testDb)).map((p) => p.name);
    expect(await names("VESTIDO")).toEqual(["Vestido floral"]);
    expect(await names("rojo")).toEqual(["Vestido floral"]);
    expect(await names("rojo vestido")).toEqual(["Vestido floral"]);
    expect(await names("ves1-s")).toEqual(["Vestido floral"]);
    expect(await names("7003")).toEqual(["Blusa de lino"]);
    expect(await names("cam1")).toEqual(["Camisa Oxford"]);
    expect(await names("azul")).toEqual(["Vestido floral"]);
    expect(await names("vestido azul rojo")).toEqual(["Vestido floral"]); // cada palabra aparece en alguna variante
    expect(await names("vestido verde")).toEqual([]); // todas las palabras deben coincidir
    expect(await names("zapato")).toEqual([]);
    expect(await names("   ")).toHaveLength(3);
  });

  it("filters by category including its subcategories", async () => {
    const w = await world();
    const names = async (categoryId: string) =>
      (await searchSellable({ categoryId }, testDb)).map((p) => p.name);
    expect(await names(w.women.id)).toEqual(["Blusa de lino", "Vestido floral"]);
    expect(await names(w.dresses.id)).toEqual(["Vestido floral"]);
    expect(await names(w.men.id)).toEqual(["Camisa Oxford"]);
  });

  it("does not list a product whose variants are all archived", async () => {
    const w = await world();
    await testDb.variant.update({ where: { id: w.blouseV.id }, data: { archivedAt: new Date() } });
    const found = await searchSellable({ q: "blusa" }, testDb);
    expect(found).toEqual([]);
  });

  it("returns at most 24 products", async () => {
    const w = await world();
    for (let index = 0; index < 30; index += 1) {
      const p = await testDb.product.create({
        data: {
          code: `X${index}`,
          name: `Extra ${index}`,
          categoryId: w.men.id,
          basePriceCents: 1000,
        },
      });
      await testDb.variant.create({
        data: { productId: p.id, sku: `X${index}`, barcode: `X-${index}` },
      });
    }
    expect(await searchSellable({}, testDb)).toHaveLength(24);
  });
});

describe("lookupCode", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("takes a barcode straight to its garment", async () => {
    const w = await world();
    const result = await lookupCode("7001", testDb);
    expect(result).toMatchObject({
      kind: "variant",
      productName: "Vestido floral",
      variant: { variantId: w.dressS.id, sku: "VES1-S", sizeName: "S", onHand: 5 },
    });
  });

  it("takes a sku in any case, and ignores spaces around the code", async () => {
    const w = await world();
    const result = await lookupCode("  ves1-m ", testDb);
    expect(result).toMatchObject({ kind: "variant", variant: { variantId: w.dressM.id } });
  });

  it("takes a product code with one variant straight in, and lets you choose when it has several", async () => {
    const w = await world();
    expect(await lookupCode("blu1", testDb)).toMatchObject({
      kind: "variant",
      variant: { variantId: w.blouseV.id },
    });
    const several = await lookupCode("VES1", testDb);
    expect(several.kind).toBe("product");
    if (several.kind === "product") {
      expect(several.product.variants.map((v) => v.sku)).toEqual(["VES1-S", "VES1-M"]);
    }
  });

  it("finds nothing for unknown, blank, archived or retired codes", async () => {
    await world();
    for (const code of ["no-existe", "", "   ", "7009", "7006", "OLD1"]) {
      expect(await lookupCode(code, testDb)).toEqual({ kind: "none" });
    }
  });
});

describe("listPosCategories", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("lists the top-level active categories by name", async () => {
    await world();
    const categories = await listPosCategories(testDb);
    expect(categories.map((c) => c.name)).toEqual(["Hombre", "Mujer"]);
  });
});

describe("quickCustomer", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("creates a customer with just a name and a phone", async () => {
    const w = await world();
    const customer = await quickCustomer(
      w.cashier,
      { name: "  Ana Pérez ", phone: "9999-0000" },
      testDb,
    );
    expect(customer).toMatchObject({ name: "Ana Pérez", phone: "9999-0000" });
    const row = await testDb.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(row).toMatchObject({ name: "Ana Pérez", phone: "9999-0000", archivedAt: null });
  });

  it("works without a phone, and never mixes up two people without one", async () => {
    const w = await world();
    const a = await quickCustomer(w.cashier, { name: "Ana" }, testDb);
    const b = await quickCustomer(w.cashier, { name: "Ana", phone: "  " }, testDb);
    expect(a.phone).toBeNull();
    expect(a.id).not.toBe(b.id);
  });

  it("reuses the person with that phone without renaming them", async () => {
    const w = await world();
    const first = await quickCustomer(w.cashier, { name: "Ana Pérez", phone: "9999-0000" }, testDb);
    const again = await quickCustomer(
      w.cashier,
      { name: "Otra Persona", phone: "9999-0000" },
      testDb,
    );
    expect(again).toEqual(first);
    expect(await testDb.customer.count()).toBe(1);
  });

  it("brings back an archived customer", async () => {
    const w = await world();
    const first = await quickCustomer(w.cashier, { name: "Ana", phone: "9999-0000" }, testDb);
    await testDb.customer.update({ where: { id: first.id }, data: { archivedAt: new Date() } });
    const again = await quickCustomer(w.cashier, { name: "Ana", phone: "9999-0000" }, testDb);
    expect(again.id).toBe(first.id);
    expect(
      (await testDb.customer.findUniqueOrThrow({ where: { id: first.id } })).archivedAt,
    ).toBeNull();
  });

  it("creates only one customer when two boxes register the same phone at once", async () => {
    const w = await world();
    const results = await Promise.all([
      quickCustomer(w.cashier, { name: "Ana", phone: "8888-0000" }, testDb),
      quickCustomer(w.cashier, { name: "Ana", phone: "8888-0000" }, testDb),
    ]);
    expect(results[0]?.id).toBe(results[1]?.id);
    expect(await testDb.customer.count()).toBe(1);
  });

  it("refuses a bad name or phone, and roles that cannot sell", async () => {
    const w = await world();
    for (const input of [
      { name: "A" },
      { name: "" },
      { name: "Ana", phone: "12" },
      { name: "Ana", phone: "abc-defg" },
    ]) {
      await expect(quickCustomer(w.cashier, input, testDb)).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(quickCustomer(w.warehouse, { name: "Ana" }, testDb)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(await testDb.customer.count()).toBe(0);
  });
});
