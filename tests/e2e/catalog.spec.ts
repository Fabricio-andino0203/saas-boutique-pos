import { expect, test } from "@playwright/test";

import { messages } from "../../src/config/messages.es";

import { deleteE2eData } from "./helpers/cleanup";
import { loginAs } from "./helpers/login";

const catalog = messages.catalog;

test.afterAll(() => {
  deleteE2eData();
});

test("the cashier has no catalog menu and cannot open the screens", async ({ page }) => {
  await loginAs(page, "cashier");
  for (const name of [catalog.entities.brands.plural, catalog.entities.suppliers.plural]) {
    await expect(page.getByRole("link", { name, exact: true })).toHaveCount(0);
  }
  await page.goto("/catalogos/brands");
  await expect(page.getByRole("heading", { name: messages.states.notFound.title })).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 1, name: catalog.entities.brands.plural }),
  ).toHaveCount(0);
});

test("the warehouse sees brands and suppliers in the menu", async ({ page }) => {
  await loginAs(page, "warehouse");
  await expect(
    page.getByRole("link", { name: catalog.entities.brands.plural, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: catalog.entities.suppliers.plural, exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: messages.nav.users, exact: true })).toHaveCount(0);
});

test("an unknown catalog is not found", async ({ page }) => {
  await loginAs(page, "owner");
  await page.goto("/catalogos/inventada");
  await expect(page.getByRole("heading", { name: messages.states.notFound.title })).toBeVisible();
});

test("the owner creates a brand, archives it, and can see and restore it", async ({ page }) => {
  const name = `E2E Marca ${Date.now()}`;
  await loginAs(page, "owner");

  await page.goto("/catalogos/brands");
  await page.getByRole("link", { name: catalog.entities.brands.new }).click();
  await page.getByLabel(catalog.fields.name).fill(name);
  await page.getByRole("button", { name: catalog.actions.create }).click();

  await expect(page).toHaveURL(/\/catalogos\/brands$/);
  await expect(page.getByRole("cell", { name, exact: true })).toBeVisible();

  await page.getByRole("link", { name: `${catalog.actions.edit} ${name}` }).click();
  await page.getByRole("button", { name: catalog.actions.archive }).click();
  await expect(page.getByText(catalog.messages.archived)).toBeVisible();

  await page.goto("/catalogos/brands");
  await expect(page.getByRole("cell", { name, exact: true })).toHaveCount(0);

  await page.getByRole("link", { name: catalog.actions.showArchived }).click();
  await expect(page.getByRole("cell", { name, exact: true })).toBeVisible();

  await page.getByRole("link", { name: `${catalog.actions.edit} ${name}` }).click();
  await page.getByRole("button", { name: catalog.actions.restore }).click();
  await expect(page.getByText(catalog.messages.restored)).toBeVisible();
});

test("a repeated brand name shows a clear message", async ({ page }) => {
  const name = `E2E Repetida ${Date.now()}`;
  await loginAs(page, "owner");
  for (const expectError of [false, true]) {
    await page.goto("/catalogos/brands/nuevo");
    await page.getByLabel(catalog.fields.name).fill(name);
    await page.getByRole("button", { name: catalog.actions.create }).click();
    if (expectError) {
      await expect(page.getByText(messages.errors.NAME_TAKEN)).toBeVisible();
    } else {
      await expect(page).toHaveURL(/\/catalogos\/brands$/);
    }
  }
});

test("the owner creates a category inside another and sees the parent", async ({ page }) => {
  const parent = `E2E Padre ${Date.now()}`;
  const child = `E2E Hija ${Date.now()}`;
  await loginAs(page, "owner");

  await page.goto("/catalogos/categories/nuevo");
  await page.getByLabel(catalog.fields.name).fill(parent);
  await page.getByRole("button", { name: catalog.actions.create }).click();
  await expect(page).toHaveURL(/\/catalogos\/categories$/);

  await page.goto("/catalogos/categories/nuevo");
  await page.getByLabel(catalog.fields.name).fill(child);
  await page.getByLabel(catalog.fields.parentId).selectOption({ label: parent });
  await page.getByRole("button", { name: catalog.actions.create }).click();

  const row = page.getByRole("row", { name: new RegExp(child) });
  await expect(row).toBeVisible();
  await expect(row.getByRole("cell", { name: parent, exact: true })).toBeVisible();
});
