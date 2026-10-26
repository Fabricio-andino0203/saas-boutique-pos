import { expect, test } from "@playwright/test";

import { messages } from "../../src/config/messages.es";

import { loginAs } from "./helpers/login";
import { createSimpleProduct } from "./helpers/products";

const reorder = messages.reorder;
const labels = messages.labels;

test("the cashier has no reorder or labels menu and cannot open the screens", async ({ page }) => {
  await loginAs(page, "cashier");
  for (const name of [messages.nav.reorder, messages.nav.labels]) {
    await expect(page.getByRole("link", { name, exact: true })).toHaveCount(0);
  }
  await expect(page.getByText(reorder.card.title)).toHaveCount(0);
  for (const path of [
    "/inventario/reposicion",
    "/inventario/etiquetas",
    "/inventario/etiquetas/plantilla",
    "/etiquetas/imprimir?v=cualquiera:1",
  ]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: messages.states.notFound.title })).toBeVisible();
  }
});

test("a garment at its minimum shows up in the reorder list and on the home page", async ({
  page,
}) => {
  test.slow();
  const name = `E2E Reposicion ${Date.now()}`;
  await loginAs(page, "owner");
  const code = await createSimpleProduct(page, name, "60", "L 60.00");

  // Se define el mínimo de la prenda (la prenda sin existencias queda por debajo)
  const detail = messages.products.detail;
  await page.getByRole("button", { name: `${detail.editVariant} ${code}` }).click();
  const minimum = page.getByLabel(detail.variantColumns.reorder, { exact: true });
  await expect(async () => {
    await minimum.fill("2");
    await expect(minimum).toHaveValue("2");
  }).toPass();
  await page.getByRole("button", { name: detail.saveVariant, exact: true }).click();
  await expect(page.getByRole("cell", { name: "2", exact: true }).first()).toBeVisible();

  await page.goto("/inventario/reposicion");
  const row = page.getByRole("row", { name: new RegExp(name) });
  await expect(row).toBeVisible();
  await expect(row).toContainText("2"); // faltan 2

  await page.goto("/");
  await expect(page.getByRole("heading", { name: reorder.card.title })).toBeVisible();
  await expect(page.getByText(reorder.card.summary)).toBeVisible();
});

test("the owner prints labels from a product and designs the template", async ({ page }) => {
  test.slow();
  const name = `E2E Etiqueta ${Date.now()}`;
  await loginAs(page, "owner");
  await createSimpleProduct(page, name, "75", "L 75.00");

  // Desde el producto: la prenda ya viene en la lista
  await page.getByRole("link", { name: labels.fromProduct }).click();
  const quantity = page.getByLabel(`${labels.builder.quantity}: ${name}`).filter({ visible: true });
  await expect(async () => {
    await quantity.fill("3");
    await expect(quantity).toHaveValue("3");
  }).toPass();
  await expect(page.getByText(labels.builder.total)).toBeVisible();
  await page.getByRole("button", { name: labels.builder.print }).click();

  // Vista de impresión: 3 etiquetas con su código de barras
  const groups = page.getByRole("group", { name: new RegExp(`^${labels.print.label} `) });
  await expect(groups).toHaveCount(3);
  await expect(groups.first().locator("svg")).toBeVisible();
  await expect(groups.first()).toContainText(name);
  await expect(groups.first()).toContainText("L 75.00");
  await expect(page.getByRole("button", { name: labels.print.print })).toBeVisible();

  // Plantilla: cambia el tamaño y vuelve a dejarlo como estaba
  await page.goto("/inventario/etiquetas/plantilla");
  const width = page.getByLabel(labels.templateForm.width, { exact: true });
  const original = await width.inputValue();
  try {
    await expect(async () => {
      await width.fill("60");
      await expect(width).toHaveValue("60");
    }).toPass();
    await page.getByRole("button", { name: labels.templateForm.save }).click();
    await expect(page.getByText(labels.templateForm.saved)).toBeVisible();
    await page.goto(page.url().replace("/inventario/etiquetas/plantilla", "/inventario/etiquetas"));
  } finally {
    await page.goto("/inventario/etiquetas/plantilla");
    const again = page.getByLabel(labels.templateForm.width, { exact: true });
    await expect(async () => {
      await again.fill(original);
      await expect(again).toHaveValue(original);
    }).toPass();
    await page.getByRole("button", { name: labels.templateForm.save }).click();
    await expect(page.getByText(labels.templateForm.saved)).toBeVisible();
  }
});

test("an invalid template is explained and nothing is printed without labels", async ({ page }) => {
  await loginAs(page, "owner");
  await page.goto("/inventario/etiquetas/plantilla");
  const width = page.getByLabel(labels.templateForm.width, { exact: true });
  await expect(async () => {
    await width.fill("5");
    await expect(width).toHaveValue("5");
  }).toPass();
  await page.getByRole("button", { name: labels.templateForm.save }).click();
  await expect(page.getByText(labels.templateForm.invalid)).toBeVisible();

  await page.goto("/etiquetas/imprimir");
  await expect(page.getByText(labels.print.empty)).toBeVisible();
  await expect(page.getByRole("button", { name: labels.print.print })).toHaveCount(0);
});
