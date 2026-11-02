import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFileStore, type BlobStore } from "@/lib/blob-store";
import {
  ConflictError,
  ForbiddenError,
  ImageTooLargeError,
  InvalidImageError,
  NotFoundError,
  PhotoLimitError,
  ValidationError,
} from "@/lib/errors";
import { PHOTO_MAX_BYTES, sniffImageFormat } from "@/lib/images";
import type { Role } from "@/lib/permissions";
import {
  coverPhotoIds,
  findPhotoProduct,
  listProductPhotos,
  photoUsage,
} from "@/modules/photos/queries";
import {
  addProductPhoto,
  removeProductPhoto,
  reorderProductPhotos,
  setProductPhotoColor,
  type PhotoDeps,
} from "@/modules/photos/service";
import { photoKey } from "@/modules/photos/storage";

import { closeDatabase, resetDatabase, testDb } from "./helpers/db";

type Actor = { id: string; role: Role };

const FOLDER = "tenantA";
let root: string;
let store: BlobStore;
let deps: PhotoDeps;

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
  const category = await testDb.category.create({ data: { name: "Mujer", slug: "mujer" } });
  const [red, blue, green] = await Promise.all([
    testDb.color.create({ data: { name: "Rojo", hex: "#cc0000" } }),
    testDb.color.create({ data: { name: "Azul", hex: "#0000cc" } }),
    testDb.color.create({ data: { name: "Verde", hex: "#00cc00" } }),
  ]);
  const dress = await testDb.product.create({
    data: {
      code: "VES1",
      name: "Vestido floral",
      categoryId: category.id,
      basePriceCents: 100000,
      baseCostCents: 3000,
    },
  });
  const blouse = await testDb.product.create({
    data: {
      code: "BLU1",
      name: "Blusa lisa",
      categoryId: category.id,
      basePriceCents: 50000,
      baseCostCents: 2000,
    },
  });
  await testDb.variant.createMany({
    data: [
      { productId: dress.id, colorId: red.id, sku: "VES1-R", barcode: "2000000000015" },
      { productId: dress.id, colorId: blue.id, sku: "VES1-A", barcode: "2000000000022" },
      { productId: blouse.id, colorId: green.id, sku: "BLU1-V", barcode: "2000000000039" },
    ],
  });
  return { owner, manager, warehouse, cashier, dress, blouse, red, blue, green };
}

type World = Awaited<ReturnType<typeof world>>;

const photo = (width = 300, height = 400, background = "#336699") =>
  sharp({ create: { width, height, channels: 3, background } })
    .jpeg()
    .toBuffer();

async function storedFiles(): Promise<string[]> {
  return (await readdir(root, { recursive: true })).filter((entry) => entry.endsWith(".webp"));
}

beforeEach(async () => {
  await resetDatabase();
  root = await mkdtemp(path.join(tmpdir(), "photos-test-"));
  store = createFileStore(root);
  deps = { client: testDb, store, folder: FOLDER };
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

afterAll(closeDatabase);

describe("addProductPhoto", () => {
  it("stores the three sizes, records the photo and audits it", async () => {
    const w = await world();
    const added = await addProductPhoto(
      w.owner,
      w.dress.id,
      { data: await photo(), name: "C:\\fotos\\vestido rojo.jpg" },
      deps,
    );

    expect(added).toMatchObject({
      productId: w.dress.id,
      colorId: null,
      position: 0,
      width: 300,
      height: 400,
      originalName: "vestido rojo.jpg", // sin la ruta del equipo de quien lo subió
    });
    for (const size of ["thumb", "medium", "large"] as const) {
      const bytes = await store.get(photoKey(FOLDER, w.dress.id, added.id, size));
      expect(bytes && sniffImageFormat(bytes)).toBe("webp");
    }
    const row = await testDb.productImage.findUniqueOrThrow({ where: { id: added.id } });
    expect(row.bytes).toBeGreaterThan(0);

    const log = await testDb.auditLog.findFirstOrThrow({
      where: { action: "PRODUCT_PHOTO_ADDED" },
    });
    expect(log).toMatchObject({ entityType: "Product", entityId: w.dress.id, userId: w.owner.id });
  });

  it("numbers the photos 0, 1, 2… and the first one is the cover", async () => {
    const w = await world();
    const first = await addProductPhoto(w.owner, w.dress.id, { data: await photo() }, deps);
    const second = await addProductPhoto(w.owner, w.dress.id, { data: await photo() }, deps);
    const other = await addProductPhoto(w.owner, w.blouse.id, { data: await photo() }, deps);

    expect((await listProductPhotos(w.dress.id, testDb)).map((p) => [p.id, p.position])).toEqual([
      [first.id, 0],
      [second.id, 1],
    ]);
    const covers = await coverPhotoIds([w.dress.id, w.blouse.id], testDb);
    expect(covers.get(w.dress.id)).toBe(first.id);
    expect(covers.get(w.blouse.id)).toBe(other.id);
    expect(await coverPhotoIds([], testDb)).toEqual(new Map());
    expect(await findPhotoProduct(second.id, testDb)).toEqual({ productId: w.dress.id });
    expect(await findPhotoProduct("nope", testDb)).toBeNull();
  });

  it("refuses the seventh photo and leaves no file behind from the refused ones", async () => {
    const w = await world();
    for (let i = 0; i < 6; i += 1) {
      await addProductPhoto(w.owner, w.dress.id, { data: await photo() }, deps);
    }
    await expect(
      addProductPhoto(w.owner, w.dress.id, { data: await photo() }, deps),
    ).rejects.toBeInstanceOf(PhotoLimitError);

    expect(await testDb.productImage.count()).toBe(6);
    expect(await storedFiles()).toHaveLength(18);
  });

  it("never lets simultaneous uploads pass the limit or repeat a position", async () => {
    const w = await world();
    const data = await photo();

    const results = await Promise.allSettled(
      Array.from({ length: 9 }, () => addProductPhoto(w.owner, w.dress.id, { data }, deps)),
    );

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(6);
    for (const r of results.filter((r) => r.status === "rejected")) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(PhotoLimitError);
    }
    const positions = (await listProductPhotos(w.dress.id, testDb)).map((p) => p.position);
    expect(positions).toEqual([0, 1, 2, 3, 4, 5]);
    expect(await storedFiles()).toHaveLength(18); // las que no entraron no dejaron archivos
  });

  it.each([
    ["text", () => Buffer.from("no soy una foto"), InvalidImageError],
    ["an empty file", () => Buffer.alloc(0), InvalidImageError],
    [
      "a file over the size limit",
      () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(PHOTO_MAX_BYTES)]),
      ImageTooLargeError,
    ],
  ])("rejects %s without storing or recording anything", async (_name, make, error) => {
    const w = await world();

    await expect(
      addProductPhoto(w.owner, w.dress.id, { data: make() }, deps),
    ).rejects.toBeInstanceOf(error);

    expect(await testDb.productImage.count()).toBe(0);
    expect(await storedFiles()).toEqual([]);
  });

  it("cleans up the files already written if one of them cannot be stored", async () => {
    const w = await world();
    let puts = 0;
    const flaky: BlobStore = {
      ...store,
      async put(key, data) {
        puts += 1;
        if (puts === 3) {
          throw new Error("disk full");
        }
        await store.put(key, data);
      },
    };

    await expect(
      addProductPhoto(w.owner, w.dress.id, { data: await photo() }, { ...deps, store: flaky }),
    ).rejects.toThrow("disk full");

    expect(await testDb.productImage.count()).toBe(0);
    expect(await storedFiles()).toEqual([]);
  });

  it("cleans up the files if the record cannot be saved", async () => {
    const w = await world();
    const failing = new Proxy(testDb, {
      get(target, prop) {
        if (prop === "$transaction") {
          return () => Promise.reject(new Error("database down"));
        }
        return Reflect.get(target, prop) as unknown;
      },
    });

    await expect(
      addProductPhoto(w.owner, w.dress.id, { data: await photo() }, { ...deps, client: failing }),
    ).rejects.toThrow("database down");

    expect(await storedFiles()).toEqual([]);
  });

  it("refuses a product that does not exist", async () => {
    const w = await world();
    await expect(
      addProductPhoto(w.owner, "no-such-product", { data: await photo() }, deps),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await storedFiles()).toEqual([]);
  });

  it("can tie the photo to a color the product has, and only to those", async () => {
    const w = await world();

    const red = await addProductPhoto(
      w.owner,
      w.dress.id,
      { data: await photo(), colorId: w.red.id },
      deps,
    );
    expect(red).toMatchObject({ colorId: w.red.id, colorName: "Rojo", colorHex: "#cc0000" });

    await expect(
      addProductPhoto(w.owner, w.dress.id, { data: await photo(), colorId: w.green.id }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await testDb.productImage.count()).toBe(1);
  });

  it("treats an empty color as a general photo of the product", async () => {
    const w = await world();
    const added = await addProductPhoto(
      w.owner,
      w.dress.id,
      { data: await photo(), colorId: "" },
      deps,
    );
    expect(added.colorId).toBeNull();
  });

  it("is allowed to the owner, the manager and the warehouse, not to the cashier", async () => {
    const w = await world();
    for (const actor of [w.owner, w.manager, w.warehouse]) {
      await addProductPhoto(actor, w.dress.id, { data: await photo() }, deps);
    }
    await expect(
      addProductPhoto(w.cashier, w.dress.id, { data: await photo() }, deps),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await testDb.productImage.count()).toBe(3);
  });
});

describe("removeProductPhoto", () => {
  async function three(w: World) {
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      ids.push((await addProductPhoto(w.owner, w.dress.id, { data: await photo() }, deps)).id);
    }
    return ids as [string, string, string];
  }

  it("deletes the record and the files, closes the gap and audits it", async () => {
    const w = await world();
    const [a, b, c] = await three(w);

    await removeProductPhoto(w.manager, a, deps);

    expect((await listProductPhotos(w.dress.id, testDb)).map((p) => [p.id, p.position])).toEqual([
      [b, 0],
      [c, 1],
    ]);
    expect(await store.get(photoKey(FOLDER, w.dress.id, a, "medium"))).toBeNull();
    expect(await store.get(photoKey(FOLDER, w.dress.id, b, "medium"))).not.toBeNull();
    expect(await storedFiles()).toHaveLength(6);
    const log = await testDb.auditLog.findFirstOrThrow({
      where: { action: "PRODUCT_PHOTO_REMOVED" },
    });
    expect(log).toMatchObject({ entityId: w.dress.id, userId: w.manager.id });
  });

  it("does not touch the photos of other products", async () => {
    const w = await world();
    const [a] = await three(w);
    const other = await addProductPhoto(w.owner, w.blouse.id, { data: await photo() }, deps);

    await removeProductPhoto(w.owner, a, deps);

    expect((await listProductPhotos(w.blouse.id, testDb)).map((p) => p.position)).toEqual([0]);
    expect(await store.get(photoKey(FOLDER, w.blouse.id, other.id, "thumb"))).not.toBeNull();
  });

  it("answers 'not found' for a photo that is gone, and refuses the cashier", async () => {
    const w = await world();
    const [a] = await three(w);

    await expect(removeProductPhoto(w.cashier, a, deps)).rejects.toBeInstanceOf(ForbiddenError);
    await removeProductPhoto(w.owner, a, deps);
    await expect(removeProductPhoto(w.owner, a, deps)).rejects.toBeInstanceOf(NotFoundError);
    expect(await testDb.productImage.count()).toBe(2);
  });

  it("frees a place so the product can take another photo", async () => {
    const w = await world();
    const ids: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      ids.push((await addProductPhoto(w.owner, w.dress.id, { data: await photo() }, deps)).id);
    }
    await removeProductPhoto(w.owner, ids[2] as string, deps);

    const added = await addProductPhoto(w.owner, w.dress.id, { data: await photo() }, deps);

    expect(added.position).toBe(5);
    expect((await listProductPhotos(w.dress.id, testDb)).map((p) => p.position)).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
  });
});

describe("reorderProductPhotos", () => {
  it("applies the new order, and the first photo becomes the cover", async () => {
    const w = await world();
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      ids.push((await addProductPhoto(w.owner, w.dress.id, { data: await photo() }, deps)).id);
    }
    const [a, b, c] = ids as [string, string, string];

    await reorderProductPhotos(w.warehouse, w.dress.id, { orderedIds: [c, a, b] }, deps);

    expect((await listProductPhotos(w.dress.id, testDb)).map((p) => p.id)).toEqual([c, a, b]);
    expect((await coverPhotoIds([w.dress.id], testDb)).get(w.dress.id)).toBe(c);
  });

  it.each([
    ["a missing photo", (ids: string[]) => ids.slice(1)],
    ["an unknown photo", (ids: string[]) => [...ids.slice(1), "intruso"]],
    ["a repeated photo", (ids: string[]) => [ids[0], ids[0], ids[1]]],
    ["an extra photo", (ids: string[]) => [...ids, "otra"]],
  ])("refuses a list with %s: the person's screen is out of date", async (_name, change) => {
    const w = await world();
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      ids.push((await addProductPhoto(w.owner, w.dress.id, { data: await photo() }, deps)).id);
    }

    await expect(
      reorderProductPhotos(w.owner, w.dress.id, { orderedIds: change(ids) }, deps),
    ).rejects.toBeInstanceOf(ConflictError);

    expect((await listProductPhotos(w.dress.id, testDb)).map((p) => p.id)).toEqual(ids);
  });

  it("refuses a photo of another product, malformed input and the cashier", async () => {
    const w = await world();
    const a = await addProductPhoto(w.owner, w.dress.id, { data: await photo() }, deps);
    const foreign = await addProductPhoto(w.owner, w.blouse.id, { data: await photo() }, deps);

    await expect(
      reorderProductPhotos(w.owner, w.dress.id, { orderedIds: [foreign.id] }, deps),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      reorderProductPhotos(w.owner, w.dress.id, { orderedIds: [] }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(reorderProductPhotos(w.owner, w.dress.id, "nope", deps)).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      reorderProductPhotos(w.cashier, w.dress.id, { orderedIds: [a.id] }, deps),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("setProductPhotoColor", () => {
  it("moves a photo between the colors of the product and back to general", async () => {
    const w = await world();
    const added = await addProductPhoto(w.owner, w.dress.id, { data: await photo() }, deps);

    await setProductPhotoColor(w.owner, added.id, w.blue.id, deps);
    expect((await listProductPhotos(w.dress.id, testDb))[0]).toMatchObject({
      colorId: w.blue.id,
      colorName: "Azul",
    });

    await setProductPhotoColor(w.owner, added.id, null, deps);
    expect((await listProductPhotos(w.dress.id, testDb))[0]?.colorId).toBeNull();
  });

  it("refuses a color the product does not have, a missing photo and the cashier", async () => {
    const w = await world();
    const added = await addProductPhoto(w.owner, w.dress.id, { data: await photo() }, deps);

    await expect(setProductPhotoColor(w.owner, added.id, w.green.id, deps)).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(setProductPhotoColor(w.owner, "nada", w.red.id, deps)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(setProductPhotoColor(w.cashier, added.id, w.red.id, deps)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe("photoUsage", () => {
  it("counts the photos and the space they take", async () => {
    const w = await world();
    expect(await photoUsage(testDb)).toEqual({ count: 0, bytes: 0 });
    await addProductPhoto(w.owner, w.dress.id, { data: await photo() }, deps);
    await addProductPhoto(w.owner, w.blouse.id, { data: await photo() }, deps);

    const usage = await photoUsage(testDb);

    expect(usage.count).toBe(2);
    expect(usage.bytes).toBeGreaterThan(0);
  });
});

describe("a business folder", () => {
  it("keeps one business's photos out of reach of another's keys", async () => {
    const w = await world();
    const added = await addProductPhoto(w.owner, w.dress.id, { data: await photo() }, deps);

    expect(await store.get(photoKey(FOLDER, w.dress.id, added.id, "thumb"))).not.toBeNull();
    expect(await store.get(photoKey("tenantB", w.dress.id, added.id, "thumb"))).toBeNull();
  });
});
