import { expect, test } from "@playwright/test";

import { messages } from "../../src/config/messages.es";

import { loginAs } from "./helpers/login";
import { openMenuGroup } from "./helpers/menu";

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
  await openMenuGroup(page, messages.nav.groups.finance);
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

test("the owner adds a fixed cost, pays this month, sees it as an expense and gets the month back when the payment is voided", async ({
  page,
}) => {
  test.slow();
  const fixed = messages.finance.fixed;
  const name = `E2E Internet ${Date.now()}`;

  await loginAs(page, "owner");
  await openMenuGroup(page, messages.nav.groups.finance);
  await page.getByRole("link", { name: messages.nav.financeFixedCosts, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: fixed.title })).toBeVisible();

  await page.getByRole("button", { name: fixed.new }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(fixed.form.name).fill(name);
  await dialog
    .getByLabel(fixed.form.category)
    .selectOption({ label: "Servicios (agua, luz, internet)" });
  await dialog.getByLabel(fixed.form.amount).fill("900");
  await dialog.getByLabel(fixed.form.dueDay).fill("1");
  await dialog.getByRole("button", { name: fixed.form.submit }).click();
  await expect(page.getByText(messages.toasts.fixedCostCreated)).toBeVisible();

  // Aparece por pagar (vence el día 1: ya venció o vence hoy) y se paga con otro monto.
  const pending = page.getByRole("region", { name: fixed.pendingTitle });
  const pendingRow = pending.getByRole("row").filter({ hasText: name });
  await expect(pendingRow).toBeVisible();
  await expect(pendingRow).toContainText("900.00");
  await pendingRow.getByRole("button", { name: fixed.pay }).click();
  const pay = page.getByRole("dialog");
  await pay.getByLabel(fixed.payForm.amount).fill("925");
  await pay.getByRole("button", { name: fixed.payForm.submit }).click();
  await expect(page.getByText(messages.toasts.fixedCostPaid)).toBeVisible();
  await expect(pending.getByRole("row").filter({ hasText: name })).toHaveCount(0);

  // El pago es un gasto con su categoría y su mes.
  await page.goto("/finanzas/movimientos?rango=today");
  const entry = page.getByRole("row").filter({ hasText: name }).first();
  await expect(entry).toContainText("Servicios (agua, luz, internet)");
  await expect(entry).toContainText(messages.finance.entries.badges.fixedCost);
  await expect(entry).toContainText("925.00");

  // Al anularlo, el mes vuelve a estar por pagar.
  await entry.getByRole("button", { name: messages.finance.void.action }).click();
  await page
    .getByRole("dialog")
    .getByLabel(messages.finance.void.reason)
    .fill("E2E Monto equivocado");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: messages.finance.void.submit })
    .click();
  await expect(page.getByText(messages.toasts.financeEntryVoided)).toBeVisible();
  await page.goto("/finanzas/costos-fijos");
  await expect(
    page
      .getByRole("region", { name: fixed.pendingTitle })
      .getByRole("row")
      .filter({ hasText: name }),
  ).toBeVisible();

  // Archivado deja de pedir pagos.
  await page.getByRole("button", { name: `${fixed.archive}: ${name}` }).click();
  await expect(page.getByText(messages.toasts.fixedCostArchived)).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: fixed.pendingTitle })
      .getByRole("row")
      .filter({ hasText: name }),
  ).toHaveCount(0);
});

test("the summary shows the income statement with the expense categories, and the exports follow the permissions", async ({
  page,
}) => {
  test.slow();
  const summary = messages.finance.summary;

  await loginAs(page, "manager");
  await openMenuGroup(page, messages.nav.groups.finance);
  await page.getByRole("link", { name: messages.nav.financeSummary, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: summary.title })).toBeVisible();
  await expect(page.getByRole("link", { name: messages.nav.financeSummary })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("group", { name: summary.netProfit })).toBeVisible();

  // Un gasto de hoy aparece en su categoría dentro del estado de resultados.
  await page.goto("/finanzas/movimientos");
  await page.getByRole("button", { name: entries.newExpense }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(form.amount).fill("321");
  await dialog.getByLabel(form.category).selectOption({ label: "Empaques" });
  await dialog.getByLabel(form.details).fill(`E2E Bolsas ${Date.now()}`);
  await dialog.getByRole("button", { name: form.submit }).click();
  await expect(page.getByText(messages.toasts.financeEntryCreated)).toBeVisible();

  await page.goto("/finanzas?rango=today");
  const statement = page.getByRole("region", { name: summary.statementTitle });
  for (const label of [summary.lines.revenue, summary.lines.gross, summary.lines.net]) {
    await expect(statement.getByRole("row").filter({ hasText: label }).first()).toBeVisible();
  }
  await expect(statement.getByRole("row").filter({ hasText: "Empaques" })).toBeVisible();

  // El archivo del resumen sale con los mismos conceptos; sin permiso responde como si no existiera.
  const csv = await page.request.get("/api/finanzas/resumen/exportar?formato=csv&rango=today");
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  const body = await csv.text();
  expect(body).toContain(summary.lines.net);
  expect(body).toContain(summary.lines.expenses);
  const movements = await page.request.get(
    "/api/finanzas/movimientos/exportar?formato=csv&rango=today",
  );
  expect(movements.status()).toBe(200);
  expect(await movements.text()).toContain("Empaques");
  expect((await page.request.get("/api/finanzas/otro/exportar")).status()).toBe(404);
});

test("the cashier gets nothing from the Finance exports", async ({ page }) => {
  await loginAs(page, "cashier");
  const response = await page.request.get("/api/finanzas/resumen/exportar?formato=csv");
  expect(response.status()).toBe(404);
});
