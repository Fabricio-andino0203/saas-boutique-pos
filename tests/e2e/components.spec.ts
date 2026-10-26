import { expect, test } from "@playwright/test";

import { messages } from "../../src/config/messages.es";

import { loginAs } from "./helpers/login";

const gallery = messages.dev.gallery;

test.beforeEach(async ({ page }) => {
  await loginAs(page, "owner");
  await page.goto("/dev/componentes");
});

test("MoneyInput formats a valid amount on blur", async ({ page }) => {
  const input = page.getByLabel(gallery.money.label);
  await input.fill("1234.5");
  await input.blur();
  await expect(input).toHaveValue("L 1,234.50");
});

test("MoneyInput flags an invalid amount", async ({ page }) => {
  const input = page.getByLabel(gallery.money.label);
  await input.fill("12.345");
  await input.blur();
  await expect(input).toHaveAttribute("aria-invalid", "true");
});

test("ConfirmDialog opens and closes with Escape", async ({ page }) => {
  await page.getByRole("button", { name: gallery.confirm.open }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("DataTable shows its four states", async ({ page }) => {
  const loading = page.getByRole("region", { name: gallery.table.loading });
  await expect(loading.getByRole("status")).toBeVisible();

  const empty = page.getByRole("region", { name: gallery.table.empty });
  await expect(empty.getByRole("button", { name: gallery.table.emptyAction })).toBeVisible();

  const error = page.getByRole("region", { name: gallery.table.error });
  await expect(error.getByRole("alert")).toBeVisible();
  await expect(error.getByRole("button", { name: messages.common.retry })).toBeVisible();

  const rows = page.getByRole("region", { name: gallery.table.rows });
  await expect(rows.getByRole("cell", { name: gallery.table.sampleDress })).toBeVisible();
});
