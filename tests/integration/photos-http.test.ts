import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { messages } from "@/config/messages.es";
import { createFileStore, type BlobStore } from "@/lib/blob-store";
import { PHOTO_MAX_BYTES } from "@/lib/images";
import type { Role } from "@/lib/permissions";
import { handlePhotoUpload, servePhoto, type PhotoSession } from "@/modules/photos/http";
import { addProductPhoto, type PhotoDeps } from "@/modules/photos/service";

import { closeDatabase, resetDatabase, testDb } from "./helpers/db";

const FOLDER = "tenantA";
let root: string;
let store: BlobStore;
let deps: PhotoDeps;

const sessionOf = (id: string, role: Role): PhotoSession => ({ user: { id, role } });

async function world() {
  const make = async (username: string, role: Role) =>
    sessionOf(
      (await testDb.user.create({ data: { name: username, username, passwordHash: "x", role } }))
        .id,
      role,
    );
  const owner = await make("owner", "OWNER");
  const cashier = await make("cashier", "CASHIER");
  const category = await testDb.category.create({ data: { name: "Mujer", slug: "mujer" } });
  const red = await testDb.color.create({ data: { name: "Rojo", hex: "#cc0000" } });
  const dress = await testDb.product.create({
    data: {
      code: "VES1",
      name: "Vestido",
      categoryId: category.id,
      basePriceCents: 100000,
      baseCostCents: 3000,
    },
  });
  await testDb.variant.create({
    data: { productId: dress.id, colorId: red.id, sku: "VES1-R", barcode: "2000000000015" },
  });
  return { owner, cashier, dress, red };
}

const jpeg = () =>
  sharp({ create: { width: 300, height: 400, channels: 3, background: "#336699" } })
    .jpeg()
    .toBuffer();

function uploadRequest(parts: Record<string, string | File>, headers: Record<string, string> = {}) {
  const form = new FormData();
  for (const [name, value] of Object.entries(parts)) {
    form.set(name, value);
  }
  return new Request("http://tienda.test/api/productos/p/fotos", {
    method: "POST",
    body: form,
    headers: { host: "tienda.test", origin: "http://tienda.test", ...headers },
  });
}

const fileOf = async (name = "foto.jpg") =>
  new File([new Uint8Array(await jpeg())], name, { type: "image/jpeg" });

beforeEach(async () => {
  await resetDatabase();
  root = await mkdtemp(path.join(tmpdir(), "photos-http-"));
  store = createFileStore(root);
  deps = { client: testDb, store, folder: FOLDER };
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

afterAll(closeDatabase);

describe("servePhoto", () => {
  it("serves each size as WebP, cached for good, to anyone who is signed in", async () => {
    const w = await world();
    const photo = await addProductPhoto(w.owner.user, w.dress.id, { data: await jpeg() }, deps);

    for (const size of ["thumb", "medium", "large"]) {
      const response = await servePhoto(w.cashier, photo.id, size, deps);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/webp");
      expect(response.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      const body = Buffer.from(await response.arrayBuffer());
      expect(body.length).toBe(Number(response.headers.get("content-length")));
      expect((await sharp(body).metadata()).format).toBe("webp");
    }
  });

  it("answers 404 without saying why when there is no session", async () => {
    const w = await world();
    const photo = await addProductPhoto(w.owner.user, w.dress.id, { data: await jpeg() }, deps);

    const response = await servePhoto(null, photo.id, "thumb", deps);

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });

  it.each([
    ["a size that does not exist", "gigante"],
    ["a path in place of a size", "../thumb"],
    ["an empty size", ""],
  ])("answers 404 for %s", async (_name, size) => {
    const w = await world();
    const photo = await addProductPhoto(w.owner.user, w.dress.id, { data: await jpeg() }, deps);
    expect((await servePhoto(w.owner, photo.id, size, deps)).status).toBe(404);
  });

  it("answers 404 for a photo that does not exist, a very long id and an id with a path", async () => {
    const w = await world();
    expect((await servePhoto(w.owner, "no-existe", "thumb", deps)).status).toBe(404);
    expect((await servePhoto(w.owner, "x".repeat(200), "thumb", deps)).status).toBe(404);
    expect((await servePhoto(w.owner, "../../etc/passwd", "thumb", deps)).status).toBe(404);
  });

  it("answers 404 when the file is gone (a database restored without its photos)", async () => {
    const w = await world();
    const photo = await addProductPhoto(w.owner.user, w.dress.id, { data: await jpeg() }, deps);
    await rm(root, { recursive: true, force: true });

    expect((await servePhoto(w.owner, photo.id, "medium", deps)).status).toBe(404);
  });

  it("does not hand over the photo through another business's folder", async () => {
    const w = await world();
    const photo = await addProductPhoto(w.owner.user, w.dress.id, { data: await jpeg() }, deps);

    expect((await servePhoto(w.owner, photo.id, "thumb", deps)).status).toBe(200);
    expect(
      (await servePhoto(w.owner, photo.id, "thumb", { ...deps, folder: "tenantB" })).status,
    ).toBe(404);
  });
});

describe("handlePhotoUpload", () => {
  it("uploads a photo for the product and answers with it", async () => {
    const w = await world();

    const response = await handlePhotoUpload(
      w.owner,
      w.dress.id,
      uploadRequest({ file: await fileOf("rojo.jpg"), colorId: w.red.id }),
      deps,
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      ok: boolean;
      photo: { id: string; colorId: string; originalName: string };
    };
    expect(body.ok).toBe(true);
    expect(body.photo).toMatchObject({ colorId: w.red.id, originalName: "rojo.jpg" });
    expect(await testDb.productImage.count({ where: { productId: w.dress.id } })).toBe(1);
    expect((await servePhoto(w.cashier, body.photo.id, "thumb", deps)).status).toBe(200);
  });

  it("answers 401 without a session and 403 to someone who may not manage products", async () => {
    const w = await world();

    const anonymous = await handlePhotoUpload(
      null,
      w.dress.id,
      uploadRequest({ file: await fileOf() }),
      deps,
    );
    const cashier = await handlePhotoUpload(
      w.cashier,
      w.dress.id,
      uploadRequest({ file: await fileOf() }),
      deps,
    );

    expect(anonymous.status).toBe(401);
    expect(cashier.status).toBe(403);
    expect(await testDb.productImage.count()).toBe(0);
  });

  it("refuses a request that comes from another website, even with a valid session", async () => {
    const w = await world();

    const response = await handlePhotoUpload(
      w.owner,
      w.dress.id,
      uploadRequest({ file: await fileOf() }, { origin: "https://sitio-malo.example" }),
      deps,
    );

    expect(response.status).toBe(403);
    expect(await testDb.productImage.count()).toBe(0);
  });

  it("explains, in the person's words, a file that is not a photo", async () => {
    const w = await world();

    const response = await handlePhotoUpload(
      w.owner,
      w.dress.id,
      uploadRequest({ file: new File(["texto"], "nota.jpg", { type: "image/jpeg" }) }),
      deps,
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      ok: false,
      error: { code: "INVALID_IMAGE", message: messages.errors.INVALID_IMAGE },
    });
  });

  it("answers 422 when the request has no file or is not a form", async () => {
    const w = await world();

    const empty = await handlePhotoUpload(
      w.owner,
      w.dress.id,
      uploadRequest({ nota: "hola" }),
      deps,
    );
    const notAForm = await handlePhotoUpload(
      w.owner,
      w.dress.id,
      new Request("http://tienda.test/x", {
        method: "POST",
        body: "{}",
        headers: { host: "tienda.test" },
      }),
      deps,
    );

    expect(empty.status).toBe(422);
    expect(notAForm.status).toBe(422);
  });

  it("answers 413 for a body that declares more than a photo may weigh, without reading it", async () => {
    const w = await world();

    const response = await handlePhotoUpload(
      w.owner,
      w.dress.id,
      uploadRequest({ file: await fileOf() }, { "content-length": String(PHOTO_MAX_BYTES * 2) }),
      deps,
    );

    expect(response.status).toBe(413);
    expect((await response.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "IMAGE_TOO_LARGE" },
    });
  });

  it("answers 409 for the seventh photo and 404 for a product that does not exist", async () => {
    const w = await world();
    for (let i = 0; i < 6; i += 1) {
      await addProductPhoto(w.owner.user, w.dress.id, { data: await jpeg() }, deps);
    }

    const seventh = await handlePhotoUpload(
      w.owner,
      w.dress.id,
      uploadRequest({ file: await fileOf() }),
      deps,
    );
    const missing = await handlePhotoUpload(
      w.owner,
      "no-existe",
      uploadRequest({ file: await fileOf() }),
      deps,
    );

    expect(seventh.status).toBe(409);
    expect(((await seventh.json()) as { error: { code: string } }).error.code).toBe("PHOTO_LIMIT");
    expect(missing.status).toBe(404);
  });

  it("answers 500 with the generic message when something unexpected breaks, without leaking the cause", async () => {
    const w = await world();
    const broken: PhotoDeps = {
      ...deps,
      store: {
        ...store,
        async put() {
          throw new Error("secret disk path /var/lib/x");
        },
      },
    };

    const response = await handlePhotoUpload(
      w.owner,
      w.dress.id,
      uploadRequest({ file: await fileOf() }),
      broken,
    );

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain("secret");
    expect(JSON.parse(text)).toEqual({
      ok: false,
      error: { code: "UNEXPECTED", message: messages.errors.UNEXPECTED },
    });
  });
});
