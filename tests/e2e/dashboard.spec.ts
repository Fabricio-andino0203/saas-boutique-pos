import { expect, test } from "@playwright/test";

import { messages } from "../../src/config/messages.es";

import { loginAs } from "./helpers/login";

const copy = messages.reports.dashboard;

test("the manager's home shows the day's cards, with profit and low stock", async ({ page }) => {
  await loginAs(page, "manager");
  await expect(page.getByRole("heading", { name: copy.title, level: 2 })).toBeVisible();
  for (const label of [copy.sales, copy.tickets, copy.average, copy.profit, copy.lowStock]) {
    await expect(page.getByRole("group", { name: label, exact: true })).toBeVisible();
  }
  await page.getByRole("link", { name: copy.viewReports }).click();
  await expect(page.getByRole("heading", { name: messages.reports.title, level: 1 })).toBeVisible();
});

test("the cashier's home shows only their own figures, without profit", async ({ page }) => {
  await loginAs(page, "cashier");
  await expect(page.getByRole("heading", { name: copy.title, level: 2 })).toBeVisible();
  for (const label of [copy.sales, copy.tickets, copy.average]) {
    await expect(page.getByRole("group", { name: label, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("group", { name: copy.profit, exact: true })).toHaveCount(0);
  await expect(page.getByRole("group", { name: copy.lowStock, exact: true })).toHaveCount(0);
});

test("the warehouse's home has no sales dashboard", async ({ page }) => {
  await loginAs(page, "warehouse");
  await expect(page.getByRole("heading", { name: copy.title, level: 2 })).toHaveCount(0);
  await expect(page.getByRole("group", { name: copy.sales, exact: true })).toHaveCount(0);
});
