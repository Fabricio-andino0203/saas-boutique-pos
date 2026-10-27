import { expect, test } from "@playwright/test";

import { messages } from "../../src/config/messages.es";

import { closeLeftoverCash, fillMoney } from "./helpers/cash";
import { loginAs } from "./helpers/login";

const copy = messages.cash;

// Hay una sola terminal ("Caja 1"): solo puede haber un turno abierto, así que estas pruebas van en fila.
test.describe.configure({ mode: "serial" });

test("people without a cash drawer have no cash menu and cannot open the screens", async ({
  page,
}) => {
  await loginAs(page, "warehouse");
  await expect(page.getByRole("link", { name: messages.nav.cash, exact: true })).toHaveCount(0);
  for (const path of ["/caja", "/caja/cierres", "/imprimir/cierre/cualquiera"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: messages.states.notFound.title })).toBeVisible();
  }
});

test("the cashier opens the shift, moves cash, closes with a difference and a manager approves", async ({
  page,
  browser,
}) => {
  test.slow();
  await loginAs(page, "cashier");
  await closeLeftoverCash(page);
  await page.goto("/caja");

  // Abrir con fondo de L 500
  await expect(page.getByRole("heading", { name: copy.open.title })).toBeVisible();
  await fillMoney(page, copy.open.float, "500");
  await page.getByRole("button", { name: copy.open.submit }).click();
  const expected = page.getByRole("group", { name: copy.current.expected });
  await expect(expected).toContainText("L 500.00");

  // Una salida de L 100 con motivo, y una que no se puede (más de lo que hay)
  await fillMoney(page, copy.movements.amount, "100");
  await page.getByLabel(copy.movements.reason, { exact: true }).fill("E2E pago de flete");
  await page.getByRole("button", { name: copy.movements.submit }).click();
  await expect(expected).toContainText("L 400.00");

  await fillMoney(page, copy.movements.amount, "9999");
  await page.getByLabel(copy.movements.reason, { exact: true }).fill("E2E demasiado");
  await page.getByRole("button", { name: copy.movements.submit }).click();
  await expect(page.getByText(messages.errors.INSUFFICIENT_CASH)).toBeVisible();
  await expect(expected).toContainText("L 400.00");

  // Una entrada de L 50
  await page.getByRole("radio", { name: copy.movements.IN }).check();
  await fillMoney(page, copy.movements.amount, "50");
  await page.getByLabel(copy.movements.reason, { exact: true }).fill("E2E cambio del banco");
  await page.getByRole("button", { name: copy.movements.submit }).click();
  await expect(expected).toContainText("L 450.00");

  // Cerrar contando L 449: falta L 1 y el comentario es obligatorio
  await fillMoney(page, copy.close.counted, "449");
  await page.getByRole("button", { name: copy.close.check }).click();
  await expect(page.getByText(`${copy.close.short} L 1.00`)).toBeVisible();
  const closeButton = page.getByRole("button", { name: copy.close.submit, exact: true });
  await expect(closeButton).toBeDisabled();
  await page.getByLabel(copy.close.notes).fill("E2E faltó un billete de un lempira");
  await expect(closeButton).toBeEnabled();
  await closeButton.click();

  // Queda por aprobar; la cajera no puede aprobar su propio cierre
  await expect(page).toHaveURL(/\/caja\/cierres\/[a-z0-9]+$/);
  const detailUrl = page.url();
  await expect(page.getByText(copy.status.CLOSED_PENDING_APPROVAL, { exact: true })).toBeVisible();
  await expect(page.getByText(copy.approve.needManager)).toBeVisible();
  await expect(page.getByRole("button", { name: copy.approve.action })).toHaveCount(0);
  await expect(page.getByRole("region", { name: copy.detail.notes })).toContainText(
    "E2E faltó un billete de un lempira",
  );

  // Una caja cerrada ya no recibe movimientos: /caja vuelve a pedir abrir
  await page.goto("/caja");
  await expect(page.getByRole("heading", { name: copy.open.title })).toBeVisible();

  // El gerente la ve en la lista de pendientes y la aprueba
  const other = await browser.newContext({ baseURL: new URL(detailUrl).origin });
  const manager = await other.newPage();
  await loginAs(manager, "manager");
  await manager.goto("/caja/cierres");
  await expect(
    manager.getByText(copy.list.pending).or(manager.getByText(copy.list.pendingOne)),
  ).toBeVisible();
  await manager.goto(detailUrl);
  await manager.getByRole("button", { name: copy.approve.action }).click();
  await expect(manager.getByText(copy.approve.approved)).toBeVisible();
  await expect(manager.getByText(copy.status.CLOSED, { exact: true })).toBeVisible();
  await expect(manager.getByRole("button", { name: copy.approve.action })).toHaveCount(0);

  // La hoja para imprimir lleva el resumen y las firmas
  await manager.goto(detailUrl.replace("/caja/cierres/", "/imprimir/cierre/"));
  await expect(manager.getByRole("heading", { name: copy.print.title })).toBeVisible();
  await expect(manager.getByText(copy.print.signCashier)).toBeVisible();
  await expect(manager.getByText(copy.print.signManager)).toBeVisible();
  await expect(manager.getByRole("button", { name: copy.print.print })).toBeVisible();
  await other.close();
});

test("the cashier counts bills and coins and closes a shift that balances", async ({ page }) => {
  test.slow();
  await loginAs(page, "cashier");
  await closeLeftoverCash(page);
  await page.goto("/caja");

  await fillMoney(page, copy.open.float, "0");
  await page.getByRole("button", { name: copy.open.submit }).click();
  const expected = page.getByRole("group", { name: copy.current.expected });
  await expect(expected).toContainText("L 0.00");

  await page.getByRole("radio", { name: copy.movements.IN }).check();
  await fillMoney(page, copy.movements.amount, "700");
  await page.getByLabel(copy.movements.reason, { exact: true }).fill("E2E cambio inicial");
  await page.getByRole("button", { name: copy.movements.submit }).click();
  await expect(expected).toContainText("L 700.00");

  // L 500 + L 200 por denominaciones: el total sale solo
  await page.getByRole("checkbox", { name: copy.close.byDenomination }).check();
  await page.getByLabel(`${copy.close.denomination} L 500.00`, { exact: true }).fill("1");
  await page.getByLabel(`${copy.close.denomination} L 200.00`, { exact: true }).fill("1");
  await expect(page.getByText(copy.close.denominationsTotal)).toContainText("L 700.00");
  await page.getByRole("button", { name: copy.close.check }).click();
  await expect(page.getByText(copy.close.matches)).toBeVisible();

  // Cuadra: no hace falta comentario
  const closeButton = page.getByRole("button", { name: copy.close.submit, exact: true });
  await expect(closeButton).toBeEnabled();
  await closeButton.click();
  await expect(page).toHaveURL(/\/caja\/cierres\/[a-z0-9]+$/);
  await expect(
    page.getByRole("heading", { name: messages.cash.detail.denominationsTitle }),
  ).toBeVisible();
  await expect(page.getByText("× 1")).toHaveCount(2);
});
