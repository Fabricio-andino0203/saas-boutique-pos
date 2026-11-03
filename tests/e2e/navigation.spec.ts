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
  await expect(link(messages.nav.sell)).not.toHaveAttribute("aria-current", "page");
  await expect(link(messages.nav.home)).not.toHaveAttribute("aria-current", "page");
});

test("the menu groups its screens, opens the group of the page and remembers what the person opened", async ({
  page,
}) => {
  await loginAs(page, "owner");
  const group = (name: string) => page.getByRole("button", { name, exact: true });
  const link = (name: string) => page.getByRole("link", { name, exact: true });
  const { sales, merchandise, finance } = messages.nav.groups;

  // Al empezar solo está abierto el primer grupo: el menú no es una lista larga.
  await expect(group(sales)).toHaveAttribute("aria-expanded", "true");
  await expect(link(messages.nav.sell)).toBeVisible();
  await expect(group(merchandise)).toHaveAttribute("aria-expanded", "false");
  await expect(link(messages.nav.products)).toHaveCount(0);

  await group(merchandise).click();
  await expect(link(messages.nav.products)).toBeVisible();
  await link(messages.nav.products).click();
  await expect(page).toHaveURL(/\/productos/);
  await expect(link(messages.nav.products)).toHaveAttribute("aria-current", "page");

  // Lo abierto se recuerda al recargar, y un grupo se puede cerrar aunque tenga la pantalla actual.
  await page.reload();
  await expect(group(merchandise)).toHaveAttribute("aria-expanded", "true");
  await group(sales).click();
  await expect(link(messages.nav.sell)).toHaveCount(0);
  await page.reload();
  await expect(group(sales)).toHaveAttribute("aria-expanded", "false");

  // Entrar a una pantalla de un grupo cerrado lo abre.
  await page.goto("/finanzas/movimientos");
  await expect(group(finance)).toHaveAttribute("aria-expanded", "true");
  await expect(link(messages.nav.financeEntries)).toHaveAttribute("aria-current", "page");
});

test("the menu shrinks to icons, each group opens its list and the choice survives a reload", async ({
  page,
}) => {
  await loginAs(page, "owner");
  const toggle = page.getByRole("button", { name: messages.common.toggleSidebar });
  const group = (name: string) => page.getByRole("button", { name, exact: true });
  const link = (name: string) => page.getByRole("link", { name, exact: true });

  await toggle.click();
  await expect(group(messages.nav.groups.sales)).toBeVisible();
  await expect(link(messages.nav.sell)).toHaveCount(0); // la lista vive dentro del icono

  await group(messages.nav.groups.sales).hover();
  await expect(link(messages.nav.cashClosings)).toBeVisible();
  await link(messages.nav.cashClosings).click();
  await expect(page).toHaveURL(/\/caja\/cierres$/);
  await expect(group(messages.nav.groups.sales)).toBeVisible();

  // La elección se guarda en una cookie: recargar no vuelve a abrir el menú.
  await page.reload();
  await expect(group(messages.nav.groups.sales)).toBeVisible();
  await expect(link(messages.nav.sell)).toHaveCount(0);

  await toggle.click();
  await expect(link(messages.nav.sell)).toBeVisible();
});
