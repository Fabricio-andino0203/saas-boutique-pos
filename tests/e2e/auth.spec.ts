import { expect, test } from "@playwright/test";

import { messages } from "../../src/config/messages.es";

import { loginAs } from "./helpers/login";

test("a visitor without a session is sent to the login page", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole("heading", { level: 1, name: messages.auth.login.title }),
  ).toBeVisible();
});

test("a protected page remembers where the visitor was going", async ({ page }) => {
  await page.goto("/cuenta");
  await expect(page).toHaveURL(/\/login\?next=%2Fcuenta$/);
});

test("a wrong password shows a clear message and stays on the login page", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel(messages.auth.login.username).fill("no-existe");
  await page.getByLabel(messages.auth.login.password).fill("clave-incorrecta");
  await page.getByRole("button", { name: messages.auth.login.submit }).click();
  await expect(page.getByText(messages.errors.INVALID_CREDENTIALS)).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test("the cashier signs in, sees only her menu and signs out", async ({ page }) => {
  await loginAs(page, "cashier");

  await expect(page.getByRole("link", { name: messages.nav.home, exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: messages.nav.account })).toContainText("Cajero Demo");
  await expect(page.getByRole("link", { name: messages.nav.account })).toContainText(
    messages.auth.roles.CASHIER,
  );

  await page.getByRole("button", { name: messages.auth.logout }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});

test("the account page offers the password form", async ({ page }) => {
  await loginAs(page, "manager");
  await page.goto("/cuenta");
  await expect(
    page.getByRole("heading", { level: 1, name: messages.auth.account.title }),
  ).toBeVisible();
  await expect(page.getByLabel(messages.auth.account.currentPassword)).toBeVisible();
  await expect(page.getByLabel(messages.auth.account.newPassword, { exact: true })).toBeVisible();
});

test("a signed-in user visiting the login page goes home", async ({ page }) => {
  await loginAs(page, "owner");
  await page.goto("/login");
  await expect(page).toHaveURL(/\/$/);
});
