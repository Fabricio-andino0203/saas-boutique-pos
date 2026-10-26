import { expect, test } from "@playwright/test";

import { messages } from "../../src/config/messages.es";

import { loginAs } from "./helpers/login";
import { createSimpleProduct } from "./helpers/products";

const copy = messages.inventory;

test("the cashier has no inventory menu and cannot open the screens", async ({ page }) => {
  await loginAs(page, "cashier");
  await expect(page.getByRole("link", { name: messages.nav.stock, exact: true })).toHaveCount(0);
  for (const path of ["/inventario", "/inventario/kardex/cualquiera"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: messages.states.notFound.title })).toBeVisible();
  }
});

test("the warehouse sees the stock without any cost", async ({ page }) => {
  await loginAs(page, "warehouse");
  await page.getByRole("link", { name: messages.nav.stock, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: copy.title })).toBeVisible();
  await expect(page.getByText(copy.summary.priceValue)).toBeVisible();
  await expect(page.getByText(copy.summary.costValue)).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: copy.columns.costValue })).toHaveCount(0);
});

test("the owner sees the valuation at cost and at price", async ({ page }) => {
  await loginAs(page, "owner");
  await page.goto("/inventario");
  const card = (label: string) => page.getByRole("term").filter({ hasText: label });
  await expect(card(copy.summary.costValue)).toBeVisible();
  await expect(card(copy.summary.priceValue)).toBeVisible();
});

test("a new product shows as out of stock, with its matrix and an empty kardex", async ({
  page,
}) => {
  test.slow();
  const name = `E2E Inventario ${Date.now()}`;
  await loginAs(page, "owner");
  await createSimpleProduct(page, name, "120", "L 120.00");

  await page.goto(`/inventario?q=${encodeURIComponent(name)}&mostrar=out`);
  const row = page.getByRole("row", { name: new RegExp(name) });
  await expect(row).toBeVisible();
  await expect(row.getByText(copy.status.out)).toBeVisible();

  await page.goto(`/inventario?q=${encodeURIComponent(name)}&mostrar=in`);
  await expect(page.getByRole("row", { name: new RegExp(name) })).toHaveCount(0);

  await page.goto(`/inventario?q=${encodeURIComponent(name)}`);
  await page.getByRole("button", { name: `${copy.showSizes}: ${name}` }).click();
  await page.getByRole("link", { name: new RegExp(`^${copy.matrix.kardexOf} `) }).click();

  await expect(
    page.getByRole("heading", { level: 1, name: `${copy.kardex.title}: ${name}` }),
  ).toBeVisible();
  await expect(page.getByText(copy.kardex.empty.title)).toBeVisible();
});

test("the owner adjusts the stock with a reason and sees it in the kardex", async ({ page }) => {
  test.slow();
  const name = `E2E Ajuste ${Date.now()}`;
  const adjust = copy.adjust;
  await loginAs(page, "owner");
  await createSimpleProduct(page, name, "90", "L 90.00");

  await page.goto(`/inventario?q=${encodeURIComponent(name)}`);
  await page.getByRole("button", { name: `${copy.showSizes}: ${name}` }).click();
  await page.getByRole("link", { name: new RegExp(`^${copy.matrix.kardexOf} `) }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: new RegExp(copy.kardex.title) }),
  ).toBeVisible();

  const quantity = page.getByLabel(adjust.quantity, { exact: true });
  const reason = page.getByLabel(adjust.reason, { exact: true });
  const submit = page.getByRole("button", { name: adjust.submit });
  const fill = async (mode: string, amount: string, why: string, note = "") => {
    await expect(async () => {
      await page.getByRole("radio", { name: mode }).check();
      await quantity.fill(amount);
      await reason.selectOption({ label: why });
      await page.getByLabel(adjust.note, { exact: true }).fill(note);
      await expect(quantity).toHaveValue(amount);
    }).toPass();
  };

  // Sin motivo no se puede
  await fill(adjust.modes.in, "5", adjust.chooseReason);
  await submit.click();
  await expect(page.getByText(adjust.validation.reason)).toBeVisible();

  // Entran 5
  await fill(adjust.modes.in, "5", adjust.reasons.COUNT_ERROR);
  await submit.click();
  await expect(page.getByText(adjust.done)).toBeVisible();
  await expect(page.getByRole("row", { name: /Ajuste \(entrada\)/ })).toContainText("+5");

  // "Otro" pide detalle
  await fill(adjust.modes.out, "2", adjust.reasons.OTHER);
  await submit.click();
  await expect(page.getByText(adjust.validation.note)).toBeVisible();

  // Salen 2, con detalle
  await fill(adjust.modes.out, "2", adjust.reasons.OTHER, "Se cayó del exhibidor");
  await submit.click();
  await expect(page.getByRole("row", { name: /Ajuste \(salida\)/ })).toContainText(
    "Otro: Se cayó del exhibidor",
  );

  // No se puede sacar más de lo que hay (quedan 3)
  await fill(adjust.modes.out, "10", adjust.reasons.THEFT);
  await submit.click();
  await expect(page.getByText(messages.errors.INSUFFICIENT_STOCK)).toBeVisible();

  // La existencia actual es 3
  await expect(page.getByRole("term").filter({ hasText: copy.kardex.current })).toBeVisible();
  await expect(page.getByRole("definition").filter({ hasText: /^3$/ })).toBeVisible();
});
