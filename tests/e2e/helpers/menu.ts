import { expect, type Page } from "@playwright/test";

/**
 * Abre un grupo del menú lateral. Los grupos arrancan plegados, salvo el primero y el de la pantalla actual, así que una
 * prueba que quiere hacer clic en un enlace de otro grupo lo abre primero.
 */
export async function openMenuGroup(page: Page, name: string): Promise<void> {
  const group = page.getByRole("button", { name, exact: true });
  await expect(group).toBeVisible();
  if ((await group.getAttribute("aria-expanded")) !== "true") {
    await group.click();
  }
  await expect(group).toHaveAttribute("aria-expanded", "true");
}
