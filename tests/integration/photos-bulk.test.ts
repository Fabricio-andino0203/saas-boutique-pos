import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFileStore } from "@/lib/blob-store";
import { MAX_MATCH_FILES, matchPhotoFileNames } from "@/modules/photos/bulk";
import { PHOTO_GRID_PAGE_SIZE, listProductsForPhotos } from "@/modules/photos/queries";
import { addProductPhoto, type PhotoDeps } from "@/modules/photos/service";

import { closeDatabase, resetDatabase, testDb } from "./helpers/db";

const owner = { id: "", role: "OWNER" as const };
let root: string;
let deps: PhotoDeps;

async function world() {
  owner.id = (
    await testDb.user.create({
      data: { name: "owner", username: "owner", passwordHash: "x", role: "OWNER" },
    })
  ).id;
  const category = await testDb.category.create({ data: { name: "Mujer", slug: "mujer" } });
  const [red, blue] = await Promise.all([
    testDb.color.create({ data: { name: "Rojo" } }),
    testDb.color.create({ data: { name: "Azul" } }),
  ]);
  const make = (code: string, name: string, archivedAt: Date | null = null) =>
    testDb.product.create({
      data: { code, name, categoryId: category.id, basePriceCents: 100000, archivedAt },
    });
  const dress = await make("VES-001", "Vestido floral");
  const shirt = await make("CAM-001", "Camisa lisa");
  const old = await make("OLD-9", "Prenda vieja", new Date());
  await testDb.variant.createMany({
    data: [
      { productId: dress.id, colorId: red.id, sku: "VES-001-R", barcode: "2000000000015" },
      { productId: dress.id, colorId: blue.id, sku: "VES-001-A", barcode: "2000000000022" },
      { productId: shirt.id, sku: "CAM-001-U", barcode: "2000000000039" },
    ],
  });
  return { dress, shirt, old, red, blue, category };
}

const jpeg = () =>
  sharp({ create: { width: 60, height: 80, channels: 3, background: "#aa3355" } })
    .jpeg()
    .toBuffer();

beforeEach(async () => {
  await resetDatabase();
  root = await mkdtemp(path.join(tmpdir(), "photos-bulk-"));
  deps = { client: testDb, store: createFileStore(root), folder: "tenantA" };
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

afterAll(closeDatabase);

describe("matchPhotoFileNames", () => {
  it("finds the product by code, whatever the case or the extension", async () => {
    const w = await world();

    const [a, b, c] = await matchPhotoFileNames(
      ["VES-001.jpg", "ves-001.PNG", "Cam-001.webp"],
      testDb,
    );

    expect(a).toMatchObject({
      matched: true,
      productId: w.dress.id,
      code: "VES-001",
      colorId: null,
    });
    expect(b).toMatchObject({ matched: true, productId: w.dress.id });
    expect(c).toMatchObject({ matched: true, productId: w.shirt.id, productName: "Camisa lisa" });
  });

  it("understands an order number and a free word after the code, without a color", async () => {
    const w = await world();

    const found = await matchPhotoFileNames(
      ["VES-001_2.jpg", "VES-001 (3).jpg", "VES-001-espalda.jpg", "CAM-001-frente.jpg"],
      testDb,
    );

    expect(found.map((match) => match.matched && match.productId)).toEqual([
      w.dress.id,
      w.dress.id,
      w.dress.id,
      w.shirt.id,
    ]);
    expect(found.every((match) => match.matched && match.colorId === null)).toBe(true);
  });

  it("ties the photo to a color the product has, ignoring case and accents", async () => {
    const w = await world();

    const [red, blue, other] = await matchPhotoFileNames(
      ["VES-001_rojo.jpg", "ves-001 AZUL.png", "VES-001_púrpura.jpg"],
      testDb,
    );

    expect(red).toMatchObject({ matched: true, colorId: w.red.id, colorName: "Rojo" });
    expect(blue).toMatchObject({ matched: true, colorId: w.blue.id, colorName: "Azul" });
    expect(other).toMatchObject({ matched: true, productId: w.dress.id, colorId: null }); // el producto no tiene ese color
  });

  it("does not match a color that belongs to a different product", async () => {
    await world();
    const [shirt] = await matchPhotoFileNames(["CAM-001_rojo.jpg"], testDb);
    expect(shirt).toMatchObject({ matched: true, colorId: null });
  });

  it("leaves without a product what it does not recognise, an archived product and empty names", async () => {
    await world();

    const found = await matchPhotoFileNames(
      ["XYZ-777.jpg", "OLD-9.jpg", ".jpg", "", "ves.jpg"],
      testDb,
    );

    expect(found.map((match) => match.matched)).toEqual([false, false, false, false, false]);
    expect(found.map((match) => match.name)).toEqual([
      "XYZ-777.jpg",
      "OLD-9.jpg",
      ".jpg",
      "",
      "ves.jpg",
    ]);
  });

  it("answers once per name, in the same order", async () => {
    const w = await world();
    const names = ["CAM-001.jpg", "nada.jpg", "VES-001_2.jpg", "CAM-001.jpg"];

    const found = await matchPhotoFileNames(names, testDb);

    expect(found.map((match) => match.name)).toEqual(names);
    expect(found.map((match) => match.matched && match.productId)).toEqual([
      w.shirt.id,
      false,
      w.dress.id,
      w.shirt.id,
    ]);
  });

  it("only looks at the first batch of names", async () => {
    await world();
    const names = Array.from(
      { length: MAX_MATCH_FILES + 25 },
      (_, index) => `VES-001_${index}.jpg`,
    );
    expect(await matchPhotoFileNames(names, testDb)).toHaveLength(MAX_MATCH_FILES);
    expect(await matchPhotoFileNames([], testDb)).toEqual([]);
  });

  it("is not fooled by SQL or wildcard characters in a name", async () => {
    await world();
    const found = await matchPhotoFileNames(
      ["%.jpg", "VES-001' OR '1'='1.jpg", "_.jpg", "\\.jpg"],
      testDb,
    );
    // Nada de eso es el código de un producto: ni un comodín de LIKE, ni una comilla que cierre el texto.
    expect(found).toHaveLength(4);
    expect(found.every((match) => !match.matched)).toBe(true);
    expect(await testDb.product.count()).toBe(3); // y la tabla sigue intacta
  });
});

describe("listProductsForPhotos", () => {
  it("lists first the products without a photo and counts how many already have one", async () => {
    const w = await world();
    const data = await jpeg();
    await addProductPhoto(owner, w.dress.id, { data }, deps);
    await addProductPhoto(owner, w.dress.id, { data }, deps);

    const missing = await listProductsForPhotos({ missingOnly: true }, testDb);
    const all = await listProductsForPhotos({}, testDb);

    expect(missing.rows.map((row) => row.code)).toEqual(["CAM-001"]);
    expect(missing).toMatchObject({ total: 1, withPhotos: 1, active: 2 }); // el archivado no cuenta
    expect(all.rows.map((row) => [row.code, row.photoCount])).toEqual([
      ["CAM-001", 0],
      ["VES-001", 2],
    ]);
    expect(all.rows[1]?.coverImageId).not.toBeNull();
    expect(all.rows[0]?.coverImageId).toBeNull();
  });

  it("searches by name or code and keeps the filter", async () => {
    const w = await world();
    await addProductPhoto(owner, w.dress.id, { data: await jpeg() }, deps);

    expect(
      (await listProductsForPhotos({ q: "camisa" }, testDb)).rows.map((row) => row.code),
    ).toEqual(["CAM-001"]);
    expect((await listProductsForPhotos({ q: "VES-001", missingOnly: true }, testDb)).rows).toEqual(
      [],
    );
    expect((await listProductsForPhotos({ q: "VES-001" }, testDb)).rows).toHaveLength(1);
  });

  it("pages the grid", async () => {
    const w = await world();
    for (let index = 0; index < PHOTO_GRID_PAGE_SIZE + 3; index += 1) {
      await testDb.product.create({
        data: {
          code: `P${String(index).padStart(3, "0")}`,
          name: `Producto ${String(index).padStart(3, "0")}`,
          categoryId: w.category.id,
          basePriceCents: 100000,
        },
      });
    }

    const first = await listProductsForPhotos({ missingOnly: true, page: 1 }, testDb);
    const second = await listProductsForPhotos({ missingOnly: true, page: 2 }, testDb);
    const nonsense = await listProductsForPhotos({ missingOnly: true, page: -4 }, testDb);

    expect(first.rows).toHaveLength(PHOTO_GRID_PAGE_SIZE);
    expect(first.total).toBe(PHOTO_GRID_PAGE_SIZE + 3 + 2);
    expect(second.rows).toHaveLength(5);
    expect(nonsense.page).toBe(1);
  });
});
