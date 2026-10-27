import { expect, type Page } from "@playwright/test";

import { messages } from "../../../src/config/messages.es";

const copy = messages.cash;

/** Escribe un monto en un campo de dinero y lo confirma al salir del campo. */
export async function fillMoney(page: Page, label: string, value: string): Promise<void> {
  const input = page.getByLabel(label, { exact: true });
  await expect(async () => {
    // Al enfocar, el campo pasa de "L 9,999.00" a texto editable: se espera ese cambio antes de escribir.
    await input.focus();
    await input.fill(value);
    await input.blur();
    await expect(input).toHaveValue(/^L /);
  }).toPass();
}

/**
 * Deja la terminal libre para las pruebas: si la persona que ya inició sesión tiene una caja abierta
 * (de una corrida anterior que falló), la cierra contando cero. Con la caja de otra persona avisa.
 */
export async function closeLeftoverCash(page: Page): Promise<void> {
  await page.goto("/caja");
  const closeTitle = page.getByRole("heading", { name: copy.close.title });
  const openTitle = page.getByRole("heading", { name: copy.open.title });
  const busy = page.getByText(copy.open.busyBy);
  await expect(closeTitle.or(openTitle).or(busy)).toBeVisible();
  if (await busy.isVisible()) {
    throw new Error("La caja la tiene abierta otra persona: ciérrala antes de correr las pruebas.");
  }
  if (await openTitle.isVisible()) {
    return;
  }
  await fillMoney(page, copy.close.counted, "0");
  await page.getByRole("button", { name: copy.close.check }).click();
  await page.getByLabel(copy.close.notes).fill("E2E cierre automático de prueba");
  await page.getByRole("button", { name: copy.close.submit, exact: true }).click();
  await expect(page).toHaveURL(/\/caja\/cierres\/[a-z0-9]+$/);
}
