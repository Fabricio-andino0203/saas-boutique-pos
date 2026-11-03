import { expect, test } from "@playwright/test";

import { messages } from "../../src/config/messages.es";

import { loginAs } from "./helpers/login";
import { openMenuGroup } from "./helpers/menu";
import { createSimpleProduct, fillMoney } from "./helpers/products";

const copy = messages.purchasing;

test("the cashier has no purchases menu and cannot open the screens", async ({ page }) => {
  await loginAs(page, "cashier");
  await expect(page.getByRole("link", { name: messages.nav.purchases, exact: true })).toHaveCount(
    0,
  );
  for (const path of [
    "/compras",
    "/compras/nueva",
    "/compras/recepciones",
    "/compras/recepciones/nueva",
  ]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: messages.states.notFound.title })).toBeVisible();
  }
});

test("the warehouse can receive goods but cannot place orders or see totals at cost", async ({
  page,
}) => {
  await loginAs(page, "warehouse");
  await openMenuGroup(page, messages.nav.groups.inventory);
  await page.getByRole("link", { name: messages.nav.purchases, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: copy.title })).toBeVisible();
  await expect(page.getByRole("link", { name: copy.newOrder })).toHaveCount(0);
  await expect(page.getByRole("link", { name: copy.receive })).toBeVisible();

  await page.goto("/compras/nueva");
  await expect(page.getByRole("heading", { name: messages.states.notFound.title })).toBeVisible();

  await page.goto("/compras/recepciones");
  await expect(page.getByRole("heading", { level: 1, name: copy.receipts })).toBeVisible();
  await expect(page.getByText(copy.columns.total)).toHaveCount(0);
});

test("the owner orders, receives in two parts and sees the stock arrive", async ({ page }) => {
  test.slow();
  const stamp = Date.now();
  const supplier = `E2E Proveedor ${stamp}`;
  const product = `E2E Compra ${stamp}`;
  await loginAs(page, "owner");

  // Un proveedor y una prenda
  await page.goto("/catalogos/suppliers/nuevo");
  await page.getByLabel(messages.catalog.fields.name, { exact: true }).fill(supplier);
  await page.getByRole("button", { name: messages.catalog.actions.create }).click();
  await expect(page).toHaveURL(/\/catalogos\/suppliers$/);
  await createSimpleProduct(page, product, "120", "L 120.00");

  // Orden de compra: se busca la prenda por nombre y se agrega
  await page.goto("/compras/nueva");
  await expect(async () => {
    await page.getByLabel(copy.order.supplier, { exact: true }).selectOption({ label: supplier });
    await expect(page.getByLabel(copy.order.supplier, { exact: true })).toHaveValue(/.+/);
  }).toPass();
  await expect(async () => {
    await page.getByLabel(copy.picker.label, { exact: true }).fill(product);
    await page.getByLabel(copy.picker.label, { exact: true }).press("Enter");
    await expect(
      page.getByRole("button", { name: new RegExp(`^${copy.picker.pick}: ${product}`) }),
    ).toBeVisible({ timeout: 3000 });
  }).toPass();
  await page.getByRole("button", { name: new RegExp(`^${copy.picker.pick}: ${product}`) }).click();
  await expect(page.getByLabel(`${copy.columns.quantity}: ${product}`)).toHaveValue("1");
  await page.getByLabel(`${copy.columns.quantity}: ${product}`).fill("10");
  await fillMoney(page, `${copy.columns.cost}: ${product}`, "50", "L 50.00");
  await page.getByRole("button", { name: copy.order.save }).click();

  // La orden nace como borrador y se marca como pedida
  await expect(page.getByText(copy.status.DRAFT, { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: /^OC-/ })).toBeVisible();
  await expect(page.getByText("L 500.00").first()).toBeVisible();
  await page.getByRole("button", { name: copy.order.place }).click();
  await expect(page.getByText(copy.order.placed)).toBeVisible();
  await expect(page.getByText(copy.status.ORDERED, { exact: true })).toBeVisible();
  const orderUrl = page.url();

  // Primera recepción: llegan 4 de 10
  await page.getByRole("link", { name: copy.receive }).click();
  // Con Cache Components la pantalla anterior queda oculta en el DOM: solo cuenta lo que se ve.
  const quantity = page
    .getByLabel(`${copy.columns.quantity}: ${product}`)
    .filter({ visible: true });
  await expect(quantity).toHaveValue("10");
  await expect(async () => {
    await quantity.click();
    await quantity.press("ControlOrMeta+a");
    await quantity.pressSequentially("4");
    await expect(quantity).toHaveValue("4");
  }).toPass();
  await page.getByRole("button", { name: copy.receipt.confirm }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: new RegExp(`^${copy.receipt.detailTitle} RC-`) }),
  ).toBeVisible();
  await expect(page.getByText(copy.receipt.created)).toBeVisible();

  // La orden quedó recibida en parte, con 6 pendientes
  await page.goto(orderUrl);
  await expect(page.getByText(copy.status.PARTIALLY_RECEIVED, { exact: true })).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(product) })).toContainText("6");

  // Segunda recepción: llegan los 6 que faltaban
  await page.getByRole("link", { name: copy.receive }).click();
  await expect(
    page.getByLabel(`${copy.columns.quantity}: ${product}`).filter({ visible: true }),
  ).toHaveValue("6");
  await page.getByRole("button", { name: copy.receipt.confirm }).click();
  await expect(page.getByText(copy.receipt.created)).toBeVisible();
  await page.goto(orderUrl);
  await expect(page.getByText(copy.status.RECEIVED, { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /^RC-/ })).toHaveCount(2);

  // El inventario tiene las 10 prendas y el kardex lo cuenta
  await page.goto(`/inventario?q=${encodeURIComponent(product)}`);
  await expect(page.getByRole("row", { name: new RegExp(product) })).toContainText("10");
  await page.getByRole("button", { name: `${messages.inventory.showSizes}: ${product}` }).click();
  await page
    .getByRole("link", { name: new RegExp(`^${messages.inventory.matrix.kardexOf} `) })
    .click();
  await expect(page.getByRole("row", { name: /Compra/ })).toHaveCount(2);

  // El historial del proveedor lista las dos recepciones
  await page.goto("/compras/recepciones");
  await page.getByLabel(copy.filters.supplier, { exact: true }).selectOption({ label: supplier });
  await page.getByRole("button", { name: copy.filters.apply }).click();
  await expect(page.getByRole("row", { name: new RegExp(supplier) })).toHaveCount(2);
});
