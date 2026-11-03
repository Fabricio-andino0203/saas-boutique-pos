import { expect, test } from "@playwright/test";

import { messages } from "../../src/config/messages.es";

import { loginAs } from "./helpers/login";

test("the sidebar marks the page that is open and only that one", async ({ page }) => {
  await loginAs(page, "owner");
  const link = (name: string) => page.getByRole("link", { name, exact: true });

  await expect(link(messages.nav.home)).toHaveAttribute("aria-current", "page");
  await expect(link(messages.nav.sell)).not.toHaveAttribute("aria-current", "page");

  await page.goto("/caja/cierres");
  await expect(link(messages.nav.cashClosings)).toHaveAttribute("aria-current", "page");
  await expect(link(messages.nav.cash)).not.toHaveAttribute("aria-current", "page");
  await expect(link(messages.nav.home)).not.toHaveAttribute("aria-current", "page");
});
