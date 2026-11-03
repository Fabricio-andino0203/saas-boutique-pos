import { expect, type Locator, type Page } from "@playwright/test";

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

/** El botón «Caja» del encabezado del punto de venta (con «exact» para no confundirlo con «Cerrar caja»). */
export const cashButton = (page: Page): Locator =>
  page.getByRole("button", { name: messages.pos.actions.cash, exact: true });

/**
 * Abre el panel «Caja» de Vender (en la pestaña indicada) y devuelve el panel. Hay que estar en `/vender` con el turno abierto.
 */
export async function openCashPanel(
  page: Page,
  tab: "shift" | "movements" | "close" = "shift",
): Promise<Locator> {
  await cashButton(page).click();
  const panel = page.getByRole("dialog", { name: copy.panel.title });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("group", { name: copy.current.expected })).toBeVisible();
  if (tab !== "shift") {
    await panel.getByRole("tab", { name: copy.panel.tabs[tab] }).click();
  }
  return panel;
}

/**
 * Abre el turno desde Vender con ese fondo y espera a que aparezca el punto de venta. Si el último cierre dejó un fondo distinto,
 * la pantalla pide explicar por qué: el comentario se llena solo.
 */
export async function openShift(page: Page, float: string): Promise<void> {
  await page.goto("/vender");
  await expect(page.getByRole("heading", { name: copy.open.title, exact: true })).toBeVisible();
  await fillMoney(page, copy.open.float, float);
  const notes = page.getByLabel(copy.open.changedNotes);
  if (await notes.isVisible()) {
    await notes.fill("E2E fondo de prueba");
  }
  await page.getByRole("button", { name: copy.open.submit }).click();
  await expect(cashButton(page)).toBeVisible();
}

/**
 * Deja la terminal libre para las pruebas: si la persona que ya inició sesión tiene una caja abierta
 * (de una corrida anterior que falló), la cierra contando cero. Con la caja de otra persona avisa.
 */
export async function closeLeftoverCash(page: Page): Promise<void> {
  await page.goto("/vender");
  const openTitle = page.getByRole("heading", { name: copy.open.title, exact: true });
  await expect(openTitle.or(cashButton(page))).toBeVisible();
  if (await openTitle.isVisible()) {
    return;
  }
  await cashButton(page).click();
  const panel = page.getByRole("dialog", { name: copy.panel.title });
  await expect(panel).toBeVisible();
  const notYours = panel.getByText(copy.panel.notYours);
  const expected = panel.getByRole("group", { name: copy.current.expected });
  await expect(notYours.or(expected)).toBeVisible();
  if (await notYours.isVisible()) {
    throw new Error("La caja la tiene abierta otra persona: ciérrala antes de correr las pruebas.");
  }
  await panel.getByRole("tab", { name: copy.panel.tabs.close }).click();
  await fillMoney(page, copy.close.counted, "0");
  await panel.getByRole("button", { name: copy.close.check }).click();
  await panel.getByLabel(copy.close.notes).fill("E2E cierre automático de prueba");
  await panel.getByRole("button", { name: copy.close.submit, exact: true }).click();
  await expect(page).toHaveURL(/\/caja\/cierres\/[a-z0-9]+$/);
}
