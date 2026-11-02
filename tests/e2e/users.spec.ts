import { expect, test } from "@playwright/test";

import { messages } from "../../src/config/messages.es";

import { loginAs } from "./helpers/login";

const notFoundTitle = messages.states.notFound.title;

for (const username of ["cashier", "warehouse", "manager"] as const) {
  test(`${username} does not see or reach the admin screens`, async ({ page }) => {
    await loginAs(page, username);
    await expect(page.getByRole("link", { name: messages.nav.users, exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: messages.nav.audit, exact: true })).toHaveCount(0);

    // La página "no encontrada" aparece dentro del shell ya enviado, así que el código HTTP puede ser
    // 200; lo que importa es que no se muestre nada de administración.
    for (const path of ["/usuarios", "/usuarios/nuevo", "/auditoria"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: notFoundTitle })).toBeVisible();
      await expect(page.getByRole("heading", { name: messages.users.title })).toHaveCount(0);
      await expect(page.getByRole("heading", { name: messages.audit.title })).toHaveCount(0);
    }
  });
}

test("the owner sees the admin menu and the user list", async ({ page }) => {
  await loginAs(page, "owner");
  await expect(page.getByRole("link", { name: messages.nav.users, exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: messages.nav.audit, exact: true })).toBeVisible();

  await page.goto("/usuarios");
  await expect(page.getByRole("heading", { level: 1, name: messages.users.title })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Cajero Demo", exact: true })).toBeVisible();
  await expect(
    page.getByRole("cell", { name: messages.auth.roles.CASHIER, exact: true }).first(),
  ).toBeVisible();
});

test("the owner creates a user and the action appears in the audit log", async ({ page }) => {
  const stamp = Date.now();
  const fullName = `Persona E2E ${stamp}`;

  await loginAs(page, "owner");
  await page.goto("/usuarios/nuevo");
  await page.getByLabel(messages.users.form.name).fill(fullName);
  await page.getByLabel(messages.users.form.username, { exact: true }).fill(`e2e-${stamp}`);
  await page.getByLabel(messages.users.form.password).fill("Clave-E2E-2026");
  await page.getByRole("button", { name: messages.users.form.create }).click();

  await expect(page).toHaveURL(/\/usuarios$/);
  await expect(page.getByRole("cell", { name: fullName, exact: true })).toBeVisible();

  await page.goto("/auditoria?action=USER_CREATED");
  await expect(page.getByRole("heading", { level: 1, name: messages.audit.title })).toBeVisible();
  await expect(
    page.getByRole("cell", { name: messages.audit.actions.USER_CREATED }).first(),
  ).toBeVisible();
});

test("a repeated username shows a clear message", async ({ page }) => {
  await loginAs(page, "owner");
  await page.goto("/usuarios/nuevo");
  await page.getByLabel(messages.users.form.name).fill("Otra Persona");
  await page.getByLabel(messages.users.form.username, { exact: true }).fill("cashier");
  await page.getByLabel(messages.users.form.password).fill("Clave-E2E-2026");
  await page.getByRole("button", { name: messages.users.form.create }).click();
  await expect(page.getByText(messages.errors.USERNAME_TAKEN)).toBeVisible();
});

test("the audit filters narrow the list and an empty result is explained", async ({ page }) => {
  await loginAs(page, "owner");
  await page.goto("/auditoria?entityType=NoExisteEstaEntidad");
  await expect(page.getByText(messages.audit.empty.title)).toBeVisible();
});

test("a password set by someone else is temporary: the person must choose her own before using anything", async ({
  page,
}) => {
  const stamp = Date.now();
  const fullName = `Persona temporal ${stamp}`;
  const username = `temporal-${stamp}`;
  const temporary = "Temporal-E2E-2026";
  const own = "Clave-Propia-E2E-2026";
  const forced = messages.auth.account.forced;

  // La dueña crea a la persona y le restablece la contraseña.
  await loginAs(page, "owner");
  await page.goto("/usuarios/nuevo");
  await page.getByLabel(messages.users.form.name).fill(fullName);
  await page.getByLabel(messages.users.form.username, { exact: true }).fill(username);
  await page.getByLabel(messages.users.form.password).fill("Clave-Inicial-E2E-2026");
  await page.getByRole("button", { name: messages.users.form.create }).click();
  await expect(page).toHaveURL(/\/usuarios$/);
  const row = page.getByRole("row").filter({ hasText: fullName });
  await row.getByRole("link", { name: messages.users.edit }).click();
  await page.getByLabel(messages.users.resetPassword.label).fill(temporary);
  await page.getByRole("button", { name: messages.users.resetPassword.submit }).click();
  await expect(page.getByText(messages.users.resetPassword.done)).toBeVisible();
  await page.getByRole("button", { name: messages.auth.logout }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole("heading", { level: 1, name: messages.auth.login.title }),
  ).toBeVisible();

  // Entra con la temporal: solo puede elegir una propia. Ninguna otra pantalla se abre.
  await page.getByLabel(messages.auth.login.username).fill(username);
  await page.getByLabel(messages.auth.login.password, { exact: true }).fill(temporary);
  await page.getByRole("button", { name: messages.auth.login.submit }).click();
  await expect(page.getByRole("heading", { level: 1, name: forced.title })).toBeVisible();
  for (const path of ["/", "/productos", "/ventas", "/cuenta"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/cambiar-contrasena$/);
  }

  // La misma contraseña no vale; una propia, sí.
  await page.getByLabel(forced.currentPassword, { exact: true }).fill(temporary);
  await page.getByLabel(messages.auth.account.newPassword, { exact: true }).fill(temporary);
  await page.getByLabel(messages.auth.account.confirmPassword, { exact: true }).fill(temporary);
  await page.getByRole("button", { name: forced.submit }).click();
  await expect(page.getByText(messages.auth.validation.passwordSame)).toBeVisible();

  // El formulario se vacía después de cada envío: se llenan los tres campos otra vez.
  await page.getByLabel(forced.currentPassword, { exact: true }).fill(temporary);
  await page.getByLabel(messages.auth.account.newPassword, { exact: true }).fill(own);
  await page.getByLabel(messages.auth.account.confirmPassword, { exact: true }).fill(own);
  await page.getByRole("button", { name: forced.submit }).click();
  await expect(page.getByRole("heading", { level: 1, name: messages.home.title })).toBeVisible();

  // Ya no es temporal: sale, vuelve a entrar con la suya y no se le vuelve a pedir nada.
  await page.getByRole("button", { name: messages.auth.logout }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: messages.auth.login.title }),
  ).toBeVisible();
  await page.getByLabel(messages.auth.login.username).fill(username);
  await page.getByLabel(messages.auth.login.password, { exact: true }).fill(own);
  await page.getByRole("button", { name: messages.auth.login.submit }).click();
  await expect(page.getByRole("heading", { level: 1, name: messages.home.title })).toBeVisible();
});
