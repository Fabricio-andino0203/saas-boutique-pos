import { expect, test } from "@playwright/test";

import { messages } from "../../src/config/messages.es";

test("the home page shows the sidebar link and the title", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: messages.nav.home, exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: messages.home.title })).toBeVisible();
});

test("the health endpoint answers ok", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: "ok" });
});

test("an unknown route shows the not-found page with 404", async ({ page }) => {
  const response = await page.goto("/ruta-que-no-existe");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: messages.states.notFound.title })).toBeVisible();
});
