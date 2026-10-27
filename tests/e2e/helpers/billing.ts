import { expect, type Page } from "@playwright/test";

import { messages } from "../../../src/config/messages.es";

const copy = messages.settings.fiscal;

/** Escribe en un campo de texto; reintenta porque la página puede no haberse hidratado todavía. */
async function typeInto(page: Page, label: string, value: string) {
  await expect(async () => {
    const field = page.getByLabel(label, { exact: true });
    await field.fill(value);
    await expect(field).toHaveValue(value);
  }).toPass();
}

/** Crea un rango de facturas de prueba para "Caja 1" (el prefijo empieza por `E2E-`: la limpieza lo reconoce). */
export async function createInvoiceRange(
  page: Page,
  prefix: string,
  expires = "2099-12-31",
): Promise<void> {
  await page.goto("/configuracion/cai");
  await expect(page.getByRole("heading", { level: 1, name: copy.title })).toBeVisible();
  await expect(async () => {
    await page.getByLabel(copy.fields.type, { exact: true }).selectOption("INVOICE");
    await page.getByLabel(copy.fields.terminal, { exact: true }).selectOption({ label: "Caja 1" });
    await expect(page.getByLabel(copy.fields.terminal, { exact: true })).not.toHaveValue("");
  }).toPass();
  await typeInto(page, copy.fields.cai, "e2e001-e2e002-e2e003-e2e004-e2e005-e6");
  await typeInto(page, copy.fields.prefix, prefix);
  await typeInto(page, copy.fields.start, "1");
  await typeInto(page, copy.fields.end, "100");
  await typeInto(page, copy.fields.expires, expires);
  await page.getByRole("button", { name: copy.create }).click();
  await expect(page.getByText(copy.created)).toBeVisible();
}

/** Desactiva el rango de prueba para que no estorbe a nadie (las ventas hechas con él siguen guardadas). */
export async function deactivateInvoiceRange(page: Page, prefix: string): Promise<void> {
  await page.goto("/configuracion/cai");
  const row = page.getByRole("row", { name: new RegExp(prefix) });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: new RegExp(copy.deactivate) }).click();
  await expect(row.getByText(copy.status.inactive)).toBeVisible();
}
