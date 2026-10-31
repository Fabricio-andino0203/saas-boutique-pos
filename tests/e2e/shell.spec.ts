import { expect, test } from "@playwright/test";

import { messages } from "../../src/config/messages.es";

import { loginAs } from "./helpers/login";

test("the home page shows the sidebar link and the title", async ({ page }) => {
  await loginAs(page, "owner");
  await expect(page.getByRole("link", { name: messages.nav.home, exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: messages.home.title })).toBeVisible();
});

test("the health endpoint answers ok", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: "ok" });
});

test("pages carry the security headers and do not announce the framework", async ({ request }) => {
  const response = await request.get("/login");
  expect(response.status()).toBe(200);
  const headers = response.headers();
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["content-security-policy"]).not.toContain("'unsafe-eval'");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["x-powered-by"]).toBeUndefined();
});

test("an unknown route shows the not-found page with 404", async ({ page }) => {
  await loginAs(page, "owner");
  const response = await page.goto("/ruta-que-no-existe");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: messages.states.notFound.title })).toBeVisible();
});
