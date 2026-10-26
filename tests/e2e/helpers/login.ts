import { expect, type Page } from "@playwright/test";

import { messages } from "../../../src/config/messages.es";
import { DEMO_USERS } from "../../../prisma/seed/run-seed";

type DemoUsername = (typeof DEMO_USERS)[number]["username"];

/** Inicia sesión con un usuario de la semilla de demostración (la base de desarrollo ya la tiene). */
export async function loginAs(page: Page, username: DemoUsername): Promise<void> {
  const demo = DEMO_USERS.find((user) => user.username === username);
  if (!demo) {
    throw new Error(`Usuario de demostración desconocido: ${username}`);
  }
  await page.goto("/login");
  await page.getByLabel(messages.auth.login.username).fill(demo.username);
  await page.getByLabel(messages.auth.login.password).fill(demo.password);
  await page.getByRole("button", { name: messages.auth.login.submit }).click();
  await expect(page.getByRole("heading", { level: 1, name: messages.home.title })).toBeVisible();
}
