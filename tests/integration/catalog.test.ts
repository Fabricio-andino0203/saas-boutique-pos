import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  ForbiddenError,
  ItemInUseError,
  NameTakenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import type { Role } from "@/lib/permissions";
import {
  createItem,
  getFieldOptions,
  getItem,
  listItems,
  setItemArchived,
  updateItem,
} from "@/modules/catalog/service";

import { closeDatabase, resetDatabase, testDb } from "./helpers/db";

const owner = { id: "owner", role: "OWNER" as Role };
const warehouse = { id: "wh", role: "WAREHOUSE" as Role };
const cashier = { id: "ca", role: "CASHIER" as Role };

async function nameOf(entity: Parameters<typeof listItems>[0], name: string) {
  return (await listItems(entity, testDb)).find((row) => row.values.name === name);
}

async function makeProduct(overrides: { brandId?: string; categoryId?: string }) {
  const category =
    overrides.categoryId !== undefined
      ? { id: overrides.categoryId }
      : await testDb.category.create({ data: { name: "Base", slug: "base-prod" } });
  return testDb.product.create({
    data: {
      code: `P-${Math.random().toString(36).slice(2, 8)}`,
      name: "Vestido",
      categoryId: category.id,
      brandId: overrides.brandId,
      basePriceCents: 1000,
    },
  });
}

describe("catalog service", () => {
  beforeEach(resetDatabase);
  afterAll(closeDatabase);

  it("creates and reads back every kind of item", async () => {
    await createItem(owner, "brands", { name: "Zara" }, testDb);
    await createItem(
      owner,
      "seasons",
      { name: "PV26", startsAt: "2026-03-01", endsAt: "2026-08-31" },
      testDb,
    );
    await createItem(owner, "sizes", { name: "M", group: "ropa", sortOrder: "3" }, testDb);
    await createItem(owner, "colors", { name: "Rojo", hex: "#b42318", sortOrder: "" }, testDb);
    await createItem(
      owner,
      "suppliers",
      { name: "Textiles SA", email: "ventas@textiles.hn", phone: "9999-0000" },
      testDb,
    );

    expect((await nameOf("brands", "Zara"))?.values).toEqual({ name: "Zara" });
    expect((await nameOf("seasons", "PV26"))?.values).toMatchObject({
      startsAt: "2026-03-01",
      endsAt: "2026-08-31",
    });
    expect((await nameOf("sizes", "M"))?.values).toMatchObject({ group: "ropa", sortOrder: "3" });
    expect((await nameOf("colors", "Rojo"))?.values).toMatchObject({
      hex: "#B42318",
      sortOrder: "0",
    });
    expect((await nameOf("suppliers", "Textiles SA"))?.values).toMatchObject({
      email: "ventas@textiles.hn",
      phone: "9999-0000",
    });
  });

  it("updates an item and keeps it findable by id", async () => {
    await createItem(owner, "brands", { name: "Zara" }, testDb);
    const created = await nameOf("brands", "Zara");
    await updateItem(owner, "brands", created!.id, { name: "Zara Home" }, testDb);
    expect((await getItem("brands", created!.id, testDb))?.values.name).toBe("Zara Home");
  });

  it("rejects repeated names", async () => {
    await createItem(owner, "brands", { name: "Zara" }, testDb);
    await expect(createItem(owner, "brands", { name: "Zara" }, testDb)).rejects.toBeInstanceOf(
      NameTakenError,
    );
    await createItem(owner, "sizes", { name: "M" }, testDb);
    await expect(createItem(owner, "sizes", { name: "M" }, testDb)).rejects.toBeInstanceOf(
      NameTakenError,
    );
    await createItem(owner, "colors", { name: "Rojo" }, testDb);
    await expect(createItem(owner, "colors", { name: "Rojo" }, testDb)).rejects.toBeInstanceOf(
      NameTakenError,
    );

    const other = await createItem(owner, "brands", { name: "Mango" }, testDb).then(() =>
      nameOf("brands", "Mango"),
    );
    await expect(
      updateItem(owner, "brands", other!.id, { name: "Zara" }, testDb),
    ).rejects.toBeInstanceOf(NameTakenError);
  });

  it("rejects invalid input", async () => {
    await expect(createItem(owner, "brands", { name: " " }, testDb)).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      createItem(owner, "colors", { name: "X", hex: "rojo" }, testDb),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("reports unknown ids", async () => {
    await expect(
      updateItem(owner, "brands", "no-existe", { name: "X" }, testDb),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      setItemArchived(owner, "brands", "no-existe", true, testDb),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await getItem("brands", "no-existe", testDb)).toBeNull();
  });
});

describe("catalog permissions", () => {
  beforeEach(resetDatabase);

  it("blocks the cashier everywhere", async () => {
    for (const entity of ["brands", "suppliers", "categories"] as const) {
      await expect(
        createItem(cashier, entity, { name: "X" }, testDb),
        entity,
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("lets the warehouse manage catalogs and suppliers", async () => {
    await expect(
      createItem(warehouse, "brands", { name: "Zara" }, testDb),
    ).resolves.toBeUndefined();
    await expect(
      createItem(warehouse, "suppliers", { name: "Textiles SA" }, testDb),
    ).resolves.toBeUndefined();
  });
});

describe("categories", () => {
  beforeEach(resetDatabase);

  it("builds the slug from the parent and lists parents before their children", async () => {
    await createItem(owner, "categories", { name: "Mujer", sortOrder: "1" }, testDb);
    await createItem(owner, "categories", { name: "Hombre", sortOrder: "2" }, testDb);
    const mujer = (await nameOf("categories", "Mujer"))!;
    await createItem(
      owner,
      "categories",
      { name: "Vestidos de Fiesta", parentId: mujer.id },
      testDb,
    );

    const slugs = (await testDb.category.findMany({ select: { slug: true } }))
      .map((c) => c.slug)
      .sort();
    expect(slugs).toEqual(["hombre", "mujer", "mujer-vestidos-de-fiesta"]);

    const list = await listItems("categories", testDb);
    expect(list.map((row) => row.values.name)).toEqual(["Mujer", "Vestidos de Fiesta", "Hombre"]);
    expect(list[1]?.values.parent).toBe("Mujer");
  });

  it("does not allow the same name twice under the same parent", async () => {
    await createItem(owner, "categories", { name: "Mujer" }, testDb);
    const mujer = (await nameOf("categories", "Mujer"))!;
    await createItem(owner, "categories", { name: "Blusas", parentId: mujer.id }, testDb);
    await expect(
      createItem(owner, "categories", { name: "Blusas", parentId: mujer.id }, testDb),
    ).rejects.toBeInstanceOf(NameTakenError);
  });

  it("prevents moving a category inside itself or its descendants", async () => {
    await createItem(owner, "categories", { name: "Mujer" }, testDb);
    const mujer = (await nameOf("categories", "Mujer"))!;
    await createItem(owner, "categories", { name: "Blusas", parentId: mujer.id }, testDb);
    const blusas = (await nameOf("categories", "Blusas"))!;

    await expect(
      updateItem(owner, "categories", mujer.id, { name: "Mujer", parentId: mujer.id }, testDb),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      updateItem(owner, "categories", mujer.id, { name: "Mujer", parentId: blusas.id }, testDb),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("offers as parents only active categories outside the item's own branch", async () => {
    await createItem(owner, "categories", { name: "Mujer" }, testDb);
    await createItem(owner, "categories", { name: "Hombre" }, testDb);
    const mujer = (await nameOf("categories", "Mujer"))!;
    const hombre = (await nameOf("categories", "Hombre"))!;
    await createItem(owner, "categories", { name: "Blusas", parentId: mujer.id }, testDb);
    await setItemArchived(owner, "categories", hombre.id, true, testDb);

    const options = (await getFieldOptions("categories", mujer.id, testDb)).parentId ?? [];
    expect(options.map((o) => o.label)).toEqual(["Ninguna (principal)"]);

    const forNew = (await getFieldOptions("categories", undefined, testDb)).parentId ?? [];
    expect(forNew.map((o) => o.label)).toEqual(["Ninguna (principal)", "Mujer", "Mujer › Blusas"]);
    expect(await getFieldOptions("brands", undefined, testDb)).toEqual({});
  });
});

describe("archiving", () => {
  beforeEach(resetDatabase);

  it("blocks archiving while active products use the brand, then allows it", async () => {
    await createItem(owner, "brands", { name: "Zara" }, testDb);
    const brand = (await nameOf("brands", "Zara"))!;
    const product = await makeProduct({ brandId: brand.id });

    await expect(setItemArchived(owner, "brands", brand.id, true, testDb)).rejects.toBeInstanceOf(
      ItemInUseError,
    );

    await testDb.product.update({ where: { id: product.id }, data: { archivedAt: new Date() } });
    await setItemArchived(owner, "brands", brand.id, true, testDb);
    expect((await nameOf("brands", "Zara"))?.archived).toBe(true);

    await setItemArchived(owner, "brands", brand.id, false, testDb);
    expect((await nameOf("brands", "Zara"))?.archived).toBe(false);
  });

  it("blocks archiving a category that has active children or products", async () => {
    await createItem(owner, "categories", { name: "Mujer" }, testDb);
    const mujer = (await nameOf("categories", "Mujer"))!;
    await createItem(owner, "categories", { name: "Blusas", parentId: mujer.id }, testDb);
    const blusas = (await nameOf("categories", "Blusas"))!;
    await expect(
      setItemArchived(owner, "categories", mujer.id, true, testDb),
    ).rejects.toBeInstanceOf(ItemInUseError);

    await makeProduct({ categoryId: blusas.id });
    await expect(
      setItemArchived(owner, "categories", blusas.id, true, testDb),
    ).rejects.toBeInstanceOf(ItemInUseError);
  });

  it("blocks archiving a size or color used by an active variant", async () => {
    await createItem(owner, "sizes", { name: "M" }, testDb);
    await createItem(owner, "colors", { name: "Rojo" }, testDb);
    const size = (await nameOf("sizes", "M"))!;
    const color = (await nameOf("colors", "Rojo"))!;
    const product = await makeProduct({});
    await testDb.variant.create({
      data: {
        productId: product.id,
        sizeId: size.id,
        colorId: color.id,
        sku: "V-1",
        barcode: "B-1",
      },
    });

    await expect(setItemArchived(owner, "sizes", size.id, true, testDb)).rejects.toBeInstanceOf(
      ItemInUseError,
    );
    await expect(setItemArchived(owner, "colors", color.id, true, testDb)).rejects.toBeInstanceOf(
      ItemInUseError,
    );
  });

  it("archives and restores seasons and suppliers without products", async () => {
    await createItem(owner, "seasons", { name: "PV26" }, testDb);
    await createItem(owner, "suppliers", { name: "Textiles SA" }, testDb);
    const season = (await nameOf("seasons", "PV26"))!;
    const supplier = (await nameOf("suppliers", "Textiles SA"))!;
    await setItemArchived(owner, "seasons", season.id, true, testDb);
    await setItemArchived(owner, "suppliers", supplier.id, true, testDb);
    expect((await nameOf("seasons", "PV26"))?.archived).toBe(true);
    expect((await nameOf("suppliers", "Textiles SA"))?.archived).toBe(true);
  });

  it("refuses archiving without permission", async () => {
    await createItem(owner, "brands", { name: "Zara" }, testDb);
    const brand = (await nameOf("brands", "Zara"))!;
    await expect(setItemArchived(cashier, "brands", brand.id, true, testDb)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});
