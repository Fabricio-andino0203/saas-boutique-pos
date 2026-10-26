import { expect, test, type Page } from "@playwright/test";

import { messages } from "../../src/config/messages.es";

import { loginAs } from "./helpers/login";

const copy = messages.products;

async function fillMoney(page: Page, label: string, amount: string, shown: string) {
  // El campo se hidrata después de cargar: reintenta hasta que tome el valor.
  await expect(async () => {
    const field = page.getByLabel(label, { exact: true });
    // Al enfocar, el campo cambia "L 250.00" por "250.00": se selecciona todo después de ese cambio.
    await field.click();
    await field.press("ControlOrMeta+a");
    await field.pressSequentially(amount);
    await field.blur();
    await expect(field).toHaveValue(shown);
  }).toPass();
}

/** Crea un producto sin tallas ni colores con el asistente y espera a estar en su ficha. */
async function createSimpleProduct(page: Page, name: string, price: string, shown: string) {
  await page.goto("/productos/nuevo");
  await page.getByLabel(copy.fields.name, { exact: true }).fill(name);
  await page.getByLabel(copy.fields.category, { exact: true }).selectOption({ label: "Mujer" });
  await fillMoney(page, copy.fields.price, price, shown);
  await page.getByRole("button", { name: copy.wizard.next }).click();
  await page.getByRole("button", { name: copy.wizard.next }).click();
  await page.getByRole("button", { name: copy.wizard.save }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

test("the cashier has no products menu and cannot open the screens", async ({ page }) => {
  await loginAs(page, "cashier");
  await expect(page.getByRole("link", { name: messages.nav.products, exact: true })).toHaveCount(0);
  await page.goto("/productos");
  await expect(page.getByRole("heading", { name: messages.states.notFound.title })).toBeVisible();
  await page.goto("/productos/nuevo");
  await expect(page.getByRole("heading", { name: messages.states.notFound.title })).toBeVisible();
});

test("the warehouse can create products but never sees costs", async ({ page }) => {
  await loginAs(page, "warehouse");
  await page.getByRole("link", { name: messages.nav.products, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: copy.title })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: copy.columns.cost })).toHaveCount(0);

  await page.goto("/productos/nuevo");
  await expect(page.getByLabel(copy.fields.price, { exact: true })).toBeVisible();
  await expect(page.getByLabel(copy.fields.cost, { exact: true })).toHaveCount(0);
});

test("the owner creates a product with sizes and colors", async ({ page }) => {
  test.slow();
  const name = `E2E Vestido ${Date.now()}`;
  await loginAs(page, "owner");

  // Paso 1: datos
  await page.goto("/productos/nuevo");
  await page.getByLabel(copy.fields.name, { exact: true }).fill(name);
  await page
    .getByLabel(copy.fields.category, { exact: true })
    .selectOption({ label: "Mujer › Vestidos" });
  await fillMoney(page, copy.fields.price, "250", "L 250.00");
  await fillMoney(page, copy.fields.cost, "100", "L 100.00");
  await page.getByRole("button", { name: copy.wizard.next }).click();

  // Paso 2: tallas y colores
  await page.getByRole("button", { name: "M", exact: true }).click();
  await page.getByRole("button", { name: "L", exact: true }).click();
  await page.getByRole("button", { name: "Rojo", exact: true }).click();
  await page.getByRole("button", { name: copy.wizard.next }).click();

  // Paso 3: cantidades y vista previa
  await expect(page.getByText(`2 ${copy.wizard.previewMany}`)).toBeVisible();
  await page.getByRole("button", { name: copy.wizard.save }).click();

  // Ficha del producto
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByText(copy.created)).toBeVisible();
  await expect(page.getByRole("cell", { name: /-M-ROJO$/ })).toBeVisible();
  await expect(page.getByRole("cell", { name: /-L-ROJO$/ })).toBeVisible();

  // Aparece en el listado y se encuentra buscando
  await page.goto(`/productos?q=${encodeURIComponent(name)}`);
  await expect(page.getByRole("link", { name })).toBeVisible();
});

test("the owner changes the price and the history remembers it", async ({ page }) => {
  test.slow();
  const name = `E2E Precios ${Date.now()}`;
  await loginAs(page, "owner");
  await createSimpleProduct(page, name, "250", "L 250.00");

  await fillMoney(page, copy.fields.price, "300", "L 300.00");
  await page.getByRole("button", { name: copy.detail.save }).click();
  await expect(page.getByText(copy.detail.saved)).toBeVisible();
  await expect(page.getByRole("cell", { name: "L 250.00 → L 300.00" })).toBeVisible();
});

test("the owner adds a size and color and gives that variant its own price", async ({ page }) => {
  test.slow();
  const name = `E2E Variante ${Date.now()}`;
  await loginAs(page, "owner");
  await createSimpleProduct(page, name, "250", "L 250.00");

  await page.getByRole("button", { name: "M", exact: true }).click();
  await page.getByRole("button", { name: "Rojo", exact: true }).click();
  await page.getByRole("button", { name: copy.detail.addSubmit }).click();
  await expect(page.getByText(copy.detail.added)).toBeVisible();
  await expect(page.getByRole("cell", { name: /-M-ROJO$/ })).toBeVisible();

  await page.getByRole("button", { name: `${copy.detail.editVariant} M · Rojo` }).click();
  await fillMoney(page, copy.detail.variantColumns.price, "350", "L 350.00");
  await page.getByRole("button", { name: copy.detail.saveVariant, exact: true }).click();
  await expect(page.getByRole("cell", { name: "L 350.00", exact: true })).toBeVisible();
});

test("the owner archives a product and restores it", async ({ page }) => {
  test.slow();
  const name = `E2E Archivable ${Date.now()}`;
  const search = `/productos?q=${encodeURIComponent(name)}`;
  await loginAs(page, "owner");
  await createSimpleProduct(page, name, "90", "L 90.00");

  await page.getByRole("button", { name: copy.detail.archive }).click();
  await expect(page.getByText(copy.detail.archived)).toBeVisible();
  await expect(page.getByText(copy.detail.archivedBanner)).toBeVisible();

  await page.goto(search);
  await expect(page.getByRole("link", { name })).toHaveCount(0);
  await page.goto(`${search}&estado=archived`);
  await page.getByRole("link", { name }).click();
  await page.getByRole("button", { name: copy.detail.restore }).click();
  await expect(page.getByText(copy.detail.restored)).toBeVisible();
});

test("the owner duplicates a product", async ({ page }) => {
  test.slow();
  const name = `E2E Duplicable ${Date.now()}`;
  await loginAs(page, "owner");
  await createSimpleProduct(page, name, "80", "L 80.00");

  await page.getByRole("button", { name: copy.detail.duplicate }).click();
  await expect(page.getByRole("heading", { level: 1, name: `${name} (copia)` })).toBeVisible();
});

test("the owner raises the price of several products at once", async ({ page }) => {
  test.slow();
  const stamp = Date.now();
  const first = `E2E Lote ${stamp} A`;
  const second = `E2E Lote ${stamp} B`;
  await loginAs(page, "owner");
  await createSimpleProduct(page, first, "100", "L 100.00");
  await createSimpleProduct(page, second, "200", "L 200.00");

  await page.goto(`/productos?q=${encodeURIComponent(`E2E Lote ${stamp}`)}`);
  await page.getByRole("checkbox", { name: `${copy.selectRow} ${first}` }).check();
  await page.getByRole("checkbox", { name: `${copy.selectRow} ${second}` }).check();
  await page.getByRole("button", { name: copy.bulk.open }).click();
  await page
    .getByLabel(copy.bulk.price, { exact: true })
    .selectOption({ label: copy.bulk.pricePercent });
  await page.getByLabel(copy.bulk.percentValue).fill("10");
  await page.getByRole("button", { name: copy.bulk.apply }).click();
  await expect(page.getByText(copy.bulk.done)).toBeVisible({ timeout: 15_000 });

  const rowOf = (name: string) => page.getByRole("row", { name: new RegExp(name) });
  await expect(rowOf(first).getByText("L 110.00")).toBeVisible({ timeout: 15_000 });
  await expect(rowOf(second).getByText("L 220.00")).toBeVisible({ timeout: 15_000 });
});
