import { expect, test, type Page } from "@playwright/test";

import { messages } from "../../src/config/messages.es";

import { loginAs } from "./helpers/login";
import { openMenuGroup } from "./helpers/menu";

const copy = messages.settings;

/** Escribe en un campo de texto; reintenta porque la página puede no haberse hidratado todavía. */
async function typeInto(page: Page, label: string, value: string) {
  await expect(async () => {
    const field = page.getByLabel(label, { exact: true });
    await field.fill(value);
    await expect(field).toHaveValue(value);
  }).toPass();
}

for (const role of ["manager", "warehouse", "cashier"] as const) {
  test(`${role} has no settings menu and cannot open the screens`, async ({ page }) => {
    await loginAs(page, role);
    await expect(page.getByRole("link", { name: messages.nav.settings, exact: true })).toHaveCount(
      0,
    );
    for (const path of ["/configuracion", "/configuracion/cai", "/bienvenida"]) {
      await page.goto(path);
      await expect(
        page.getByRole("heading", { name: messages.states.notFound.title }),
      ).toBeVisible();
    }
  });
}

test("the owner changes the business name and the cashier discount limit, then restores them", async ({
  page,
}) => {
  test.slow();
  await loginAs(page, "owner");
  await openMenuGroup(page, messages.nav.groups.admin);
  await page.getByRole("link", { name: messages.nav.settings, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: copy.title })).toBeVisible();

  const businessName = page.getByLabel(copy.business.legalName, { exact: true });
  const discount = page.getByLabel(copy.rules.discount, { exact: true });
  const original = {
    name: await businessName.inputValue(),
    discount: await discount.inputValue(),
  };
  const business = page.getByRole("region", { name: copy.business.title });
  const settingsForm = page.getByRole("region", { name: copy.region });
  const saveSettings = settingsForm.getByRole("button", { name: copy.save });

  try {
    await typeInto(page, copy.business.legalName, `E2E Negocio ${Date.now()}`);
    await business.getByRole("button", { name: copy.save }).click();
    await expect(business.getByText(copy.saved)).toBeVisible();

    await typeInto(page, copy.rules.discount, "12");
    await saveSettings.click();
    await expect(settingsForm.getByText(copy.saved)).toBeVisible();

    await page.reload();
    await expect(page.getByLabel(copy.rules.discount, { exact: true })).toHaveValue("12");
  } finally {
    await typeInto(page, copy.business.legalName, original.name);
    await business.getByRole("button", { name: copy.save }).click();
    await expect(business.getByText(copy.saved)).toBeVisible();
    await typeInto(page, copy.rules.discount, original.discount);
    await saveSettings.click();
    await expect(settingsForm.getByText(copy.saved)).toBeVisible();
  }
});

test("an invalid tax rate shows a clear message", async ({ page }) => {
  await loginAs(page, "owner");
  await page.goto("/configuracion");
  await typeInto(page, copy.tax.rate, "quince");
  await page.getByRole("button", { name: copy.save }).last().click();
  await expect(page.getByText(copy.validation.percent)).toBeVisible();
});

test("the owner adds a billing range and deactivates it", async ({ page }) => {
  test.slow();
  await loginAs(page, "owner");
  await page.goto("/configuracion/cai");
  await expect(page.getByRole("heading", { level: 1, name: copy.fiscal.title })).toBeVisible();

  const prefix = `E2E-${Date.now() % 100000}-`;
  await page.getByLabel(copy.fiscal.fields.type, { exact: true }).selectOption("CREDIT_NOTE");
  await typeInto(page, copy.fiscal.fields.cai, "e2e001-e2e002-e2e003-e2e004-e2e005-e6");
  await typeInto(page, copy.fiscal.fields.prefix, prefix);
  await typeInto(page, copy.fiscal.fields.start, "1");
  await typeInto(page, copy.fiscal.fields.end, "100");
  await typeInto(page, copy.fiscal.fields.expires, "2099-12-31");
  await page.getByRole("button", { name: copy.fiscal.create }).click();
  await expect(page.getByText(copy.fiscal.created)).toBeVisible();

  const row = page.getByRole("row", { name: new RegExp(prefix) });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: new RegExp(copy.fiscal.deactivate) }).click();
  await expect(row.getByText(copy.fiscal.status.inactive)).toBeVisible();
});

test("a bad billing range is explained", async ({ page }) => {
  await loginAs(page, "owner");
  await page.goto("/configuracion/cai");
  await typeInto(page, copy.fiscal.fields.cai, "123");
  await typeInto(page, copy.fiscal.fields.start, "1");
  await typeInto(page, copy.fiscal.fields.end, "10");
  await typeInto(page, copy.fiscal.fields.expires, "2099-12-31");
  await page.getByRole("button", { name: copy.fiscal.create }).click();
  await expect(page.getByText(copy.validation.cai)).toBeVisible();
});

test("the owner walks through the welcome steps", async ({ page }) => {
  test.slow();
  await loginAs(page, "owner");
  await page.goto("/bienvenida");
  const next = () => page.getByRole("button", { name: copy.onboarding.next });

  await expect(page.getByLabel(copy.business.legalName, { exact: true })).toBeVisible();
  await next().click(); // negocio
  await expect(page.getByLabel(copy.tax.rate, { exact: true })).toBeVisible();
  await next().click(); // impuestos y pagos
  await expect(page.getByLabel(copy.rules.discount, { exact: true })).toBeVisible();
  await next().click(); // reglas
  await expect(page.getByRole("heading", { name: copy.onboarding.goalTitle })).toBeVisible();
  await expect(page.getByRole("button", { name: copy.sample.button })).toBeVisible();
  await next().click(); // mercadería (sin cargar datos de ejemplo)
  await expect(page.getByRole("heading", { name: copy.onboarding.doneTitle })).toBeVisible();
  await page.getByRole("button", { name: copy.onboarding.goHome }).click();
  await expect(page.getByRole("heading", { level: 1, name: messages.home.title })).toBeVisible();
  await expect(page.getByText(copy.onboarding.banner)).toHaveCount(0);
});
