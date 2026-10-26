import { expect, test } from "@playwright/test";

import { messages } from "../../src/config/messages.es";

import { deleteE2eData } from "./helpers/cleanup";
import { loginAs } from "./helpers/login";

const copy = messages.products.import;

const HEADER = "Producto,Categoría,Precio,Costo,Marca,Código,Talla,Color,Cantidad,Código de barras";

test.afterAll(() => {
  deleteE2eData();
});

test("the cashier cannot reach the import screen or the templates", async ({ page }) => {
  await loginAs(page, "cashier");
  await page.goto("/productos/importar");
  await expect(page.getByRole("heading", { name: messages.states.notFound.title })).toBeVisible();
  const response = await page.request.get("/productos/importar/plantilla?formato=csv");
  expect(response.status()).toBe(404);
});

test("the owner can download both templates", async ({ page }) => {
  await loginAs(page, "owner");
  await page.goto("/productos");
  await page.getByRole("link", { name: copy.open }).click();
  await expect(page.getByRole("heading", { level: 1, name: copy.title })).toBeVisible();
  await expect(page.getByRole("link", { name: copy.downloadXlsx })).toBeVisible();
  await expect(page.getByRole("link", { name: copy.downloadCsv })).toBeVisible();

  const csv = await page.request.get("/productos/importar/plantilla?formato=csv");
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect(await csv.text()).toContain(copy.headers.category);

  const xlsx = await page.request.get("/productos/importar/plantilla?formato=xlsx");
  expect(xlsx.status()).toBe(200);
  expect(xlsx.headers()["content-type"]).toContain("spreadsheetml");
});

test("the owner sees the problems by line, fixes the file and imports it", async ({ page }) => {
  test.slow();
  const stamp = Date.now();
  const name = `E2E Import ${stamp}`;
  const brand = `E2E Marca ${stamp}`;
  const row = (category: string) => `${name},${category},100,50,${brand},,M,Rojo,0,`;
  // El campo se hidrata después de cargar: si el archivo se elige antes, no se registra. Reintenta.
  const upload = (fileName: string, content: string) =>
    expect(async () => {
      await page.getByLabel(copy.fileLabel).setInputFiles({
        name: fileName,
        mimeType: "text/csv",
        buffer: Buffer.from(`${HEADER}\r\n${content}`),
      });
      await expect(page.getByRole("button", { name: copy.check })).toBeEnabled({ timeout: 2000 });
    }).toPass();

  await loginAs(page, "owner");
  await page.goto("/productos/importar");

  // Primero un archivo con una categoría que no existe
  await upload("con-error.csv", row("Zapatos"));
  await page.getByRole("button", { name: copy.check }).click();
  await expect(page.getByRole("alert").filter({ hasText: copy.problemsTitle })).toBeVisible();
  await expect(
    page.getByRole("row", { name: new RegExp(`^2 ${copy.headers.category} `) }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: copy.confirm })).toHaveCount(0);

  // Luego el archivo corregido
  await upload("corregido.csv", row("Mujer › Vestidos"));
  await page.getByRole("button", { name: copy.check }).click();
  await expect(
    page.getByText(`${copy.willCreate}: 1 ${copy.products}, 1 ${copy.variants}, 0 ${copy.units}.`),
  ).toBeVisible();
  await expect(page.getByText(`${copy.newBrands}: ${brand}`)).toBeVisible();

  await page.getByRole("button", { name: copy.confirm }).click();
  await expect(page.getByText(copy.done, { exact: false })).toBeVisible();

  await page.goto(`/productos?q=${encodeURIComponent(name)}`);
  await expect(page.getByRole("link", { name })).toBeVisible();
});
