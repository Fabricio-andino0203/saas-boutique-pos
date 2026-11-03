import { expect, test } from "@playwright/test";

import { messages } from "../../src/config/messages.es";

import { loginAs } from "./helpers/login";

const entries = messages.finance.entries;
const form = messages.finance.form;
const voiding = messages.finance.void;
const categories = messages.finance.categories;

test("the manager records an expense, sees it in the totals and voids it with a reason", async ({
  page,
}) => {
  test.slow();
  const detail = `E2E Recibo de luz ${Date.now()}`;

  await loginAs(page, "manager");
  await page.getByRole("link", { name: messages.nav.financeEntries, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: entries.title })).toBeVisible();
  await expect(page.getByRole("link", { name: messages.nav.financeEntries })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await page.getByRole("button", { name: entries.newExpense }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(form.amount).fill("1500");
  await dialog.getByLabel(form.category).selectOption({ label: "Servicios (agua, luz, internet)" });
  await dialog.getByLabel(form.payment).selectOption({ label: messages.finance.payments.TRANSFER });
  await dialog.getByLabel(form.details).fill(detail);
  await dialog.getByRole("button", { name: form.submit }).click();

  await expect(page.getByText(messages.toasts.financeEntryCreated)).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: detail });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Servicios (agua, luz, internet)");
  await expect(row).toContainText(messages.finance.payments.TRANSFER);
  await expect(row).toContainText("1,500.00");

  // Anular: pide el motivo y el movimiento deja de sumar pero no se borra.
  await row.getByRole("button", { name: voiding.action }).click();
  const voidDialog = page.getByRole("dialog");
  await voidDialog.getByRole("button", { name: voiding.submit }).click();
  await expect(voidDialog.getByRole("alert")).toBeVisible(); // sin motivo no se anula
  await voidDialog.getByLabel(voiding.reason).fill("E2E Se registró dos veces");
  await voidDialog.getByRole("button", { name: voiding.submit }).click();
  await expect(page.getByText(messages.toasts.financeEntryVoided)).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: detail })).toHaveCount(0);

  await page.getByLabel(entries.filters.showVoided).check();
  await page.getByRole("button", { name: entries.filters.apply }).click();
  const voidedRow = page.getByRole("row").filter({ hasText: detail });
  await expect(voidedRow).toContainText(entries.badges.voided);
  await expect(voidedRow).toContainText("E2E Se registró dos veces");
  await expect(voidedRow.getByRole("button", { name: voiding.action })).toHaveCount(0);
});

test("the cashier does not reach Finance and does not see it in the menu", async ({ page }) => {
  await loginAs(page, "cashier");
  await expect(page.getByRole("link", { name: messages.nav.financeEntries })).toHaveCount(0);
  for (const path of ["/finanzas/movimientos", "/finanzas/categorias", "/finanzas"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: messages.states.notFound.title })).toBeVisible();
  }
});

test("the owner adds, renames and archives a category, and an archived one is no longer offered", async ({
  page,
}) => {
  test.slow();
  const stamp = Date.now();
  const name = `E2E Seguridad ${stamp}`;
  const renamed = `E2E Vigilancia ${stamp}`;

  await loginAs(page, "owner");
  await page.goto("/finanzas/categorias");
  const expenses = page.getByRole("region", { name: categories.expenses });
  await expenses.getByLabel(categories.newName).fill(name);
  await expenses.getByRole("button", { name: categories.add }).click();
  await expect(page.getByText(messages.toasts.financeCategoryCreated)).toBeVisible();
  await expect(expenses.getByText(name)).toBeVisible();

  await expenses.getByRole("button", { name: `${categories.rename}: ${name}` }).click();
  await expenses.getByRole("textbox", { name: categories.rename, exact: true }).fill(renamed);
  await expenses.getByRole("button", { name: categories.save }).click();
  await expect(page.getByText(messages.toasts.financeCategoryRenamed)).toBeVisible();
  await expect(expenses.getByText(renamed)).toBeVisible();

  // Un nombre repetido se explica y no cambia nada.
  await expenses.getByLabel(categories.newName).fill(renamed.toLowerCase());
  await expenses.getByRole("button", { name: categories.add }).click();
  await expect(expenses.getByRole("alert")).toContainText(messages.errors.NAME_TAKEN);

  // Mientras está activa se ofrece al registrar un gasto; archivada, ya no.
  await page.goto("/finanzas/movimientos");
  await page.getByRole("button", { name: entries.newExpense }).click();
  await expect(
    page.getByRole("dialog").getByLabel(form.category).locator(`option:text("${renamed}")`),
  ).toHaveCount(1);
  await page.keyboard.press("Escape");

  await page.goto("/finanzas/categorias");
  await page
    .getByRole("region", { name: categories.expenses })
    .getByRole("button", { name: `${categories.archive}: ${renamed}` })
    .click();
  await expect(page.getByText(messages.toasts.financeCategoryArchived)).toBeVisible();

  await page.goto("/finanzas/movimientos");
  await page.getByRole("button", { name: entries.newExpense }).click();
  await expect(
    page.getByRole("dialog").getByLabel(form.category).locator(`option:text("${renamed}")`),
  ).toHaveCount(0);
});
