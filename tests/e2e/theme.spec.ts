import { expect, test } from "@playwright/test";

import { messages } from "../../src/config/messages.es";

import { loginAs } from "./helpers/login";

test.describe("with a light system", () => {
  test.use({ colorScheme: "light" });

  test("the toggle on the login page switches the theme and remembers it after a reload", async ({
    page,
  }) => {
    await page.goto("/login");
    const html = page.locator("html");
    await expect(html).not.toHaveClass(/dark/);

    await page.getByRole("button", { name: messages.theme.toDark }).click();
    await expect(html).toHaveClass(/dark/);
    await page.reload();
    await expect(html).toHaveClass(/dark/);

    await page.getByRole("button", { name: messages.theme.toLight }).click();
    await expect(html).not.toHaveClass(/dark/);
    await page.reload();
    await expect(html).not.toHaveClass(/dark/);
  });

  test("inside the app the toggle repaints the page and the choice follows to the next screen", async ({
    page,
  }) => {
    await loginAs(page, "owner");
    const html = page.locator("html");
    const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const lightBackground = await background();

    await page.getByRole("button", { name: messages.theme.toDark }).click();
    await expect(html).toHaveClass(/dark/);
    expect(await background()).not.toBe(lightBackground);

    await page.getByRole("link", { name: messages.nav.sell, exact: true }).click();
    await expect(page).toHaveURL(/\/vender/);
    await expect(html).toHaveClass(/dark/);
  });
});

test.describe("with a dark system", () => {
  test.use({ colorScheme: "dark" });

  test("the first visit follows the system", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("html")).toHaveClass(/dark/);
  });

  test("a stored choice wins over the system", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("theme", "light"));
    await page.goto("/login");
    await expect(page.locator("html")).not.toHaveClass(/dark/);
  });
});

test("the brand icons answer without a session, so the login tab shows them", async ({
  page,
  request,
}) => {
  for (const [path, type] of [
    ["/icon.svg", /image\/svg\+xml/],
    ["/apple-icon.png", /image\/png/],
    ["/favicon.ico", /image\/(x-icon|vnd\.microsoft\.icon)/],
  ] as const) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(200);
    expect(response.headers()["content-type"], path).toMatch(type);
  }

  await page.goto("/login");
  await expect(page.locator('link[rel="icon"][href^="/icon.svg"]')).toHaveCount(1);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
});
