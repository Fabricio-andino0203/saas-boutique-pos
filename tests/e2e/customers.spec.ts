import { expect, test } from "@playwright/test";

import { messages } from "../../src/config/messages.es";

import { loginAs } from "./helpers/login";

const clients = messages.customers;

// Estas pantallas no necesitan caja abierta: se pueden probar aparte del archivo de caja.
test("the cashier creates and edits a customer and a manager archives it", async ({
  page,
  browser,
}) => {
  test.slow();
  const stamp = Date.now();
  const name = `E2E Clienta ${stamp}`;
  const phone = `4${String(stamp).slice(-7)}`;
  const baseURL = test.info().project.use.baseURL as string;

  // La cajera crea la ficha completa
  await loginAs(page, "cashier");
  await page.goto("/clientes");
  await expect(page.getByRole("heading", { name: clients.list.title, level: 1 })).toBeVisible();
  await page.getByRole("link", { name: clients.list.new }).click();
  await page.getByLabel(clients.form.fields.name, { exact: true }).fill(name);
  await page.getByLabel(clients.form.fields.phone, { exact: true }).fill(phone);
  await page.getByLabel(clients.form.fields.email, { exact: true }).fill("clienta@correo.com");
  await page.getByLabel(clients.form.fields.taxId, { exact: true }).fill("0801-1990-54321");
  await page
    .getByLabel(clients.form.fields.notes, { exact: true })
    .fill("E2E le gustan los vestidos");
  await page.getByRole("button", { name: clients.form.create }).click();
  await expect(page.getByText(messages.toasts.customerSaved)).toBeVisible();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
  await expect(page.getByText("clienta@correo.com")).toBeVisible();
  const fichaUrl = page.url();

  // Aparece en la lista (por teléfono) y se puede editar
  await page.goto(`/clientes?q=${phone}`);
  await expect(page.getByRole("link", { name: `${clients.list.open} ${name}` })).toBeVisible();
  await page.goto(fichaUrl);
  await page.getByRole("link", { name: clients.actions.edit }).click();
  await page.getByLabel(clients.form.fields.preferredSizes, { exact: true }).fill("M en blusas");
  await page.getByRole("button", { name: clients.form.save }).click();
  await expect(page.getByText("M en blusas")).toBeVisible();

  // Un teléfono repetido se explica
  await page.goto("/clientes/nuevo");
  await page.getByLabel(clients.form.fields.name, { exact: true }).fill(`${name} bis`);
  await page.getByLabel(clients.form.fields.phone, { exact: true }).fill(phone);
  await page.getByRole("button", { name: clients.form.create }).click();
  await expect(page.getByText(messages.errors.PHONE_TAKEN)).toBeVisible();

  // La cajera no archiva
  await page.goto(fichaUrl);
  await expect(page.getByRole("button", { name: clients.actions.archive })).toHaveCount(0);

  // Un gerente la archiva: deja de salir en la lista, salvo que se pidan los archivados
  const managerContext = await browser.newContext({ baseURL });
  const manager = await managerContext.newPage();
  await loginAs(manager, "manager");
  await manager.goto(fichaUrl);
  await manager.getByRole("button", { name: clients.actions.archive }).click();
  await expect(manager.getByText(messages.toasts.customerArchived)).toBeVisible();
  await expect(manager.getByText(clients.actions.archivedNote)).toBeVisible();
  await manager.goto(`/clientes?q=${phone}`);
  await expect(manager.getByText(clients.list.empty)).toBeVisible();
  await manager.goto(`/clientes?q=${phone}&archivados=1`);
  await expect(manager.getByText(clients.list.archivedBadge)).toBeVisible();
  await managerContext.close();
});
