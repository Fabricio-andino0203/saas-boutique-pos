import { expect, type Page } from "@playwright/test";

import { messages } from "../../../src/config/messages.es";

const copy = messages.products;

/** Escribe un monto en un campo de dinero; el campo se hidrata tarde, así que reintenta hasta que tome el valor. */
export async function fillMoney(page: Page, label: string, amount: string, shown: string) {
  await expect(async () => {
    const field = page.getByLabel(label, { exact: true });
    // Al enfocar, el campo cambia "L 250.00" por "250.00": se selecciona todo después de ese cambio.
    await field.click();
    await field.press("ControlOrMeta+a");
    await field.pressSequentially(amount);
    await field.blur();
    await expect(field).toHaveValue(shown);
  }).toPass();
}

/**
 * Crea un producto sin tallas ni colores y sin existencias (así se puede limpiar), espera a estar en su
 * ficha y devuelve su código (que también es el de su única variante).
 */
export async function createSimpleProduct(
  page: Page,
  name: string,
  price: string,
  shown: string,
  category = "Mujer",
): Promise<string> {
  await page.goto("/productos/nuevo");
  await page.getByLabel(copy.fields.name, { exact: true }).fill(name);
  await page.getByLabel(copy.fields.category, { exact: true }).selectOption({ label: category });
  await fillMoney(page, copy.fields.price, price, shown);
  await page.getByRole("button", { name: copy.wizard.next }).click();
  await page.getByRole("button", { name: copy.wizard.next }).click();
  await page.getByRole("button", { name: copy.wizard.save }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  const description = await page
    .getByText(/^Código: \S+/)
    .first()
    .innerText();
  return description.replace(/^Código: /, "").trim();
}
