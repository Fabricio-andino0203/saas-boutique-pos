import { expect, test, type Page } from "@playwright/test";

import { messages } from "../../src/config/messages.es";

import { loginAs } from "./helpers/login";
import { createSimpleProduct } from "./helpers/products";

const copy = messages.counts;

// Solo puede haber un conteo en curso: estas pruebas se hacen una tras otra.
test.describe.configure({ mode: "serial" });

test("the cashier has no counts menu and cannot open the screens", async ({ page }) => {
  await loginAs(page, "cashier");
  await expect(page.getByRole("link", { name: messages.nav.counts, exact: true })).toHaveCount(0);
  for (const path of ["/inventario/conteos", "/inventario/conteos/cualquiera"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: messages.states.notFound.title })).toBeVisible();
  }
});

/** Crea una categoría y una prenda de prueba, y abre un conteo solo de esa categoría. */
async function startCountOfNewProduct(page: Page, stamp: number) {
  const category = `E2E Conteo ${stamp}`;
  const product = `E2E Conteo prenda ${stamp}`;
  await page.goto("/catalogos/categories/nuevo");
  await page.getByLabel(messages.catalog.fields.name, { exact: true }).fill(category);
  await page.getByRole("button", { name: messages.catalog.actions.create }).click();
  await expect(page).toHaveURL(/\/catalogos\/categories$/);
  const code = await createSimpleProduct(page, product, "70", "L 70.00", category);

  await page.goto("/inventario/conteos");
  await expect(async () => {
    await page.getByRole("radio", { name: copy.form.scopeCategory }).check();
    await page.getByLabel(copy.form.category, { exact: true }).selectOption({ label: category });
    await expect(page.getByLabel(copy.form.category, { exact: true })).toHaveValue(/.+/);
  }).toPass();
  await page.getByRole("button", { name: copy.form.submit }).click();
  await expect(page).toHaveURL(/\/inventario\/conteos\/[a-z0-9]+$/);
  await expect(
    page.getByText(copy.status.OPEN, { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  return { category, product, code, url: page.url() };
}

test("the owner counts with the scanner, reviews the difference and applies it", async ({
  page,
}) => {
  test.slow();
  await loginAs(page, "owner");
  const { product, code } = await startCountOfNewProduct(page, Date.now());

  // Escanear: la última prenda se ve grande con su contador
  const scanner = page.getByLabel(copy.scanner.label, { exact: true });
  await expect(async () => {
    await scanner.fill(code);
    await scanner.press("Enter");
    await expect(page.getByText(copy.scanner.counted, { exact: true })).toBeVisible({
      timeout: 4000,
    });
  }).toPass();

  // Un código que no existe avisa
  await scanner.fill("NO-EXISTE-999");
  await scanner.press("Enter");
  await expect(page.getByText(copy.scanner.notInCount)).toBeVisible();

  // Se quita lo que se escaneó de más y se deja exactamente 3 en la tabla
  const counted = page.getByLabel(new RegExp(`^${copy.columns.countedQty}: ${product}`));
  await expect(async () => {
    await page.reload();
    await counted.fill("3");
    await counted.blur();
    await page.reload();
    await expect(counted).toHaveValue("3", { timeout: 3000 });
  }).toPass();

  // Revisión: una diferencia de +3
  await page.getByRole("button", { name: copy.actions.review }).click();
  await expect(
    page.getByText(copy.status.IN_REVIEW, { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(product) })).toContainText("+3");

  // Aprobar y aplicar
  await page.getByRole("button", { name: copy.actions.approve }).click();
  await expect(page.getByText(copy.actions.approved)).toBeVisible();
  await expect(
    page.getByText(copy.status.APPLIED, { exact: true }).filter({ visible: true }),
  ).toBeVisible();

  // El inventario tiene las 3 prendas y el kardex dice de dónde salieron
  await page.goto(`/inventario?q=${encodeURIComponent(product)}`);
  await expect(page.getByRole("row", { name: new RegExp(product) })).toContainText("3");
  await page.getByRole("button", { name: `${messages.inventory.showSizes}: ${product}` }).click();
  await page
    .getByRole("link", { name: new RegExp(`^${messages.inventory.matrix.kardexOf} `) })
    .click();
  await expect(page.getByRole("row", { name: /Ajuste por conteo/ })).toContainText("+3");
});

test("the warehouse counts but cannot approve", async ({ page, browser }) => {
  test.slow();
  await loginAs(page, "owner");
  const { url } = await startCountOfNewProduct(page, Date.now() + 1);
  await page.getByRole("button", { name: copy.actions.review }).click();
  await expect(
    page.getByText(copy.status.IN_REVIEW, { exact: true }).filter({ visible: true }),
  ).toBeVisible();

  const other = await browser.newContext({ baseURL: new URL(url).origin });
  const second = await other.newPage();
  await loginAs(second, "warehouse");
  await second.goto(url);
  await expect(
    second.getByText(copy.status.IN_REVIEW, { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  await expect(second.getByText(copy.actions.needManager)).toBeVisible();
  await expect(second.getByRole("button", { name: copy.actions.approve })).toHaveCount(0);
  await other.close();

  // Se cancela: no cambia ninguna existencia y deja abrir otro conteo
  await page.getByRole("button", { name: copy.actions.cancel }).click();
  await expect(page.getByText(copy.actions.cancelled)).toBeVisible();
  await expect(
    page.getByText(copy.status.CANCELLED, { exact: true }).filter({ visible: true }),
  ).toBeVisible();
});
