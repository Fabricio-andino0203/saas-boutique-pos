import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

import { messages } from "../../src/config/messages.es";

import { loginAs } from "./helpers/login";
import { createSimpleProduct, fillMoney } from "./helpers/products";

const copy = messages.photos;
const productsCopy = messages.products;

async function picture(name: string, color = "#336699") {
  const buffer = await sharp({
    create: { width: 120, height: 160, channels: 3, background: color },
  })
    .png()
    .toBuffer();
  return { name, mimeType: "image/png", buffer };
}

/** Sube fotos con el campo de archivos; reintenta mientras la página termina de cargar (antes no hay quien escuche). */
async function pickFiles(
  page: Page,
  testId: string,
  files: { name: string; mimeType: string; buffer: Buffer }[],
  expectation: () => Promise<void>,
) {
  await expect(async () => {
    await page.getByTestId(testId).setInputFiles(files);
    await expectation();
  }).toPass();
}

test("the owner manages the photos of a product from its sheet", async ({
  page,
  browser,
  request,
}) => {
  test.slow();
  const name = `E2E Fotos ${Date.now()}`;
  await loginAs(page, "owner");
  await createSimpleProduct(page, name, "75", "L 75.00");

  const gallery = page.getByTestId("photo-gallery");
  await expect(gallery.getByText(copy.empty.title)).toBeVisible();
  await expect(gallery.getByTestId("photo-count")).toHaveText("0 de 6");

  // Tres fotos de una vez: la primera queda de principal
  const items = gallery.getByTestId("photo-item");
  await pickFiles(
    page,
    "photo-input",
    [
      await picture("uno.png", "#cc0000"),
      await picture("dos.png", "#00cc00"),
      await picture("tres.png", "#0000cc"),
    ],
    async () => {
      await expect(items).toHaveCount(3, { timeout: 8000 });
    },
  );
  await expect(gallery.getByTestId("photo-count")).toHaveText("3 de 6");
  await expect(items.first().getByText(copy.main, { exact: true })).toBeVisible();
  const sources = await items
    .locator("img")
    .evaluateAll((images) => images.map((image) => image.getAttribute("src")));
  expect(sources).toHaveLength(3);
  expect(new Set(sources).size).toBe(3);

  // La tercera pasa a principal
  await gallery.getByRole("button", { name: `${copy.makeMain} (3)` }).click();
  await expect(items.first().locator("img")).toHaveAttribute("src", sources[2] as string);

  // Se puede ver la foto (WebP, guardada en el navegador) y sin sesión no
  const served = await page.request.get(sources[2] as string);
  expect(served.status()).toBe(200);
  expect(served.headers()["content-type"]).toBe("image/webp");
  expect(served.headers()["cache-control"]).toContain("immutable");
  const anonymous = await request.get(sources[2] as string, { maxRedirects: 0 });
  expect(anonymous.status()).not.toBe(200);
  expect(anonymous.headers()["content-type"] ?? "").not.toContain("image/");

  // La tabla de productos muestra la foto principal
  await page.goto(`/productos?q=${encodeURIComponent(name)}`);
  const row = page.getByRole("row", { name: new RegExp(name) });
  await expect(row.locator("img")).toHaveAttribute("src", /^\/api\/fotos\/.+\/thumb$/);

  // El cajero ve la foto pero no puede cambiarla ni sube nada
  const baseURL = test.info().project.use.baseURL as string;
  const cashierContext = await browser.newContext({ baseURL });
  try {
    const cashier = await cashierContext.newPage();
    await loginAs(cashier, "cashier");
    expect((await cashier.request.get(sources[2] as string)).status()).toBe(200);
    await expect(cashier.getByRole("link", { name: messages.nav.photos, exact: true })).toHaveCount(
      0,
    );
    await cashier.goto("/productos/fotos");
    await expect(
      cashier.getByRole("heading", { name: messages.states.notFound.title }),
    ).toBeVisible();
    const refused = await cashier.request.post("/api/productos/cualquiera/fotos", {
      multipart: { file: await picture("x.png") },
    });
    expect(refused.status()).toBe(403);
  } finally {
    await cashierContext.close();
  }

  // Quitar una foto pide confirmación
  await page.goBack();
  await expect(gallery.getByTestId("photo-count")).toHaveText("3 de 6");
  await gallery.getByRole("button", { name: `${copy.remove} (1)` }).click();
  await page.getByRole("button", { name: copy.removeDialog.confirm }).click();
  await expect(items).toHaveCount(2);
  await expect(gallery.getByTestId("photo-count")).toHaveText("2 de 6");
  // La foto quitada ya no existe
  expect((await page.request.get(sources[2] as string)).status()).toBe(404);
});

test("a file that is not a photo is explained and nothing is saved", async ({ page }) => {
  test.slow();
  const name = `E2E Fotos malas ${Date.now()}`;
  await loginAs(page, "owner");
  await createSimpleProduct(page, name, "30", "L 30.00");
  const gallery = page.getByTestId("photo-gallery");

  await pickFiles(
    page,
    "photo-input",
    [{ name: "nota.png", mimeType: "image/png", buffer: Buffer.from("esto no es una foto") }],
    async () => {
      await expect(gallery.getByTestId("upload-queue")).toContainText(
        messages.errors.INVALID_IMAGE,
        {
          timeout: 8000,
        },
      );
    },
  );
  await expect(gallery.getByTestId("photo-count")).toHaveText("0 de 6");
});

test("photos chosen in the create wizard are uploaded once the product is saved", async ({
  page,
}) => {
  test.slow();
  const name = `E2E Fotos asistente ${Date.now()}`;
  await loginAs(page, "owner");
  await page.goto("/productos/nuevo");
  await page.getByLabel(productsCopy.fields.name, { exact: true }).fill(name);
  await page
    .getByLabel(productsCopy.fields.category, { exact: true })
    .selectOption({ label: "Mujer" });
  await fillMoney(page, productsCopy.fields.price, "90", "L 90.00");

  await pickFiles(
    page,
    "wizard-photo-input",
    [await picture("a.png", "#aa00aa"), await picture("b.png", "#00aaaa")],
    async () => {
      await expect(page.getByTestId("pending-photos").locator("li")).toHaveCount(2, {
        timeout: 5000,
      });
    },
  );
  // Se puede quitar una de las elegidas
  await page.getByRole("button", { name: `${copy.wizard.removeOne} (2)` }).click();
  await expect(page.getByTestId("pending-photos").locator("li")).toHaveCount(1);

  await page.getByRole("button", { name: productsCopy.wizard.next }).click();
  await page.getByRole("button", { name: productsCopy.wizard.next }).click();
  await page.getByRole("button", { name: productsCopy.wizard.save }).click();

  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByTestId("photo-count")).toHaveText("1 de 6");
  await expect(page.getByTestId("photo-item")).toHaveCount(1);
});

test("the Photos module assigns many photos by the product code in the file name", async ({
  page,
}) => {
  test.slow();
  const stamp = Date.now();
  const nameA = `E2E Masivo A ${stamp}`;
  const nameB = `E2E Masivo B ${stamp}`;
  await loginAs(page, "owner");
  const codeA = await createSimpleProduct(page, nameA, "50", "L 50.00");
  const codeB = await createSimpleProduct(page, nameB, "60", "L 60.00");

  await page.goto("/productos/fotos");
  await expect(page.getByTestId("photo-progress")).toBeVisible();
  const files = [
    await picture(`${codeA}.png`, "#ff0000"),
    await picture(`${codeA}_2.png`, "#ee0000"),
    await picture(`${codeB.toLowerCase()}.png`, "#0000ff"),
    await picture("sin-producto-zzz.png", "#888888"),
  ];
  await pickFiles(page, "bulk-photo-input", files, async () => {
    await expect(page.getByTestId("bulk-row")).toHaveCount(4, { timeout: 8000 });
  });

  // Antes de subir se ve a quién va cada una
  const summary = page.getByTestId("bulk-summary");
  await expect(summary).toContainText("3");
  await expect(summary).toContainText(messages.photos.bulk.review.ready);
  await expect(
    page.getByRole("row", { name: new RegExp(`${codeA}\\.png.*${nameA}`) }),
  ).toBeVisible();
  await expect(
    page.getByRole("row", { name: new RegExp(`${codeB.toLowerCase()}\\.png.*${nameB}`) }),
  ).toBeVisible();
  await expect(
    page.getByRole("row", { name: /sin-producto-zzz\.png.*No se encontró un producto/ }),
  ).toBeVisible();

  await page
    .getByRole("button", { name: new RegExp(`^${messages.photos.bulk.review.upload} \\(3\\)$`) })
    .click();
  await expect(summary).toContainText(messages.photos.bulk.uploaded, { timeout: 30_000 });
  await expect(summary).toContainText("3");

  // Quedaron en sus productos: dos en A, una en B
  await page.goto(`/productos?q=${encodeURIComponent(nameA)}`);
  await page.getByRole("link", { name: nameA }).click();
  await expect(page.getByTestId("photo-count")).toHaveText("2 de 6");
  await page.goto(`/productos?q=${encodeURIComponent(nameB)}`);
  await page.getByRole("link", { name: nameB }).click();
  await expect(page.getByTestId("photo-count")).toHaveText("1 de 6");

  // Con foto ya no salen en «Sin foto»; en «Todos» sí, y cada tarjeta deja agregar más
  await page.goto(`/productos/fotos?q=${encodeURIComponent(nameB)}`);
  await expect(page.getByText(messages.photos.bulk.noResults)).toBeVisible();
  await page.goto(`/productos/fotos?ver=todos&q=${encodeURIComponent(nameB)}`);
  const card = page.getByTestId("photo-card").filter({ hasText: nameB });
  await expect(card).toContainText(messages.photos.bulk.card.one);
  await expect(async () => {
    await card.getByTestId("card-photo-input").setInputFiles(await picture("extra.png", "#00ff00"));
    await expect(card).toContainText(`2 ${messages.photos.bulk.card.many}`, { timeout: 8000 });
  }).toPass();
});
