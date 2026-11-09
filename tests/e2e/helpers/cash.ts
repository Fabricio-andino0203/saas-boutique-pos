import { expect, type Locator, type Page } from "@playwright/test";

import { messages } from "../../../src/config/messages.es";
import { formatMoney } from "../../../src/lib/format";
import { DENOMINATIONS_CENTS } from "../../../src/modules/cash/schemas";

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

/** Lo que se puede abrir dentro del panel «Caja»: el menú («shift») o una de sus acciones. */
export type CashView = "shift" | "in" | "out" | "expense" | "close";

const ACTION_OF_VIEW = {
  in: "cashIn",
  out: "cashOut",
  expense: "expense",
  close: "close",
} as const;

/**
 * Entra a una acción del panel «Caja» ya abierto (ingresar, retirar, gasto o corte). Si el panel está dentro de otra acción,
 * vuelve primero al menú.
 */
export async function cashAction(panel: Locator, view: Exclude<CashView, "shift">): Promise<void> {
  const back = panel.getByRole("button", { name: copy.panel.back });
  if (await back.isVisible()) {
    await back.click();
  }
  await panel
    .getByRole("button", { name: copy.panel.actions[ACTION_OF_VIEW[view]], exact: true })
    .click();
}

/**
 * Abre el panel «Caja» de Vender (en el menú o directo en una acción) y devuelve el panel. Hay que estar en `/vender` con
 * el turno abierto.
 */
export async function openCashPanel(page: Page, view: CashView = "shift"): Promise<Locator> {
  await cashButton(page).click();
  const panel = page.getByRole("dialog", { name: copy.panel.title });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("group", { name: copy.current.expected })).toBeVisible();
  if (view !== "shift") {
    await cashAction(panel, view);
  }
  return panel;
}

/** Cuenta billetes y monedas hasta sumar ese monto (de mayor a menor), como lo haría una persona frente al cajón. */
export async function countCash(scope: Pick<Page, "getByLabel">, cents: number): Promise<void> {
  let rest = cents;
  for (const denomination of DENOMINATIONS_CENTS) {
    const quantity = Math.floor(rest / denomination);
    rest -= quantity * denomination;
    if (quantity > 0) {
      await scope.getByLabel(formatMoney(denomination), { exact: true }).fill(String(quantity));
    }
  }
  if (rest !== 0) {
    throw new Error(`No se puede contar ${cents} centavos con billetes y monedas.`);
  }
}

/**
 * Abre el turno desde Vender con ese fondo y espera a que aparezca el punto de venta. Si el último cierre dejó efectivo, el
 * saldo anterior es el fondo y no se puede cambiar: las pruebas cierran retirando todo para no arrastrarlo.
 */
export async function openShift(page: Page, float: string): Promise<void> {
  await page.goto("/vender");
  await expect(page.getByRole("heading", { name: copy.open.title, exact: true })).toBeVisible();
  const input = page.getByLabel(copy.open.float, { exact: true });
  if (await input.isVisible()) {
    await fillMoney(page, copy.open.float, float);
  } else {
    throw new Error(
      "La terminal tiene un saldo anterior y no se puede cambiar: cierra el turno anterior retirando todo.",
    );
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
  await cashAction(panel, "close");
  await panel.getByRole("button", { name: copy.close.check }).click();
  await panel.getByLabel(copy.close.notes).fill("E2E cierre automático de prueba");
  await panel.getByRole("button", { name: copy.close.submit, exact: true }).click();
  await expect(page).toHaveURL(/\/caja\/cierres\/[a-z0-9]+$/);
}
