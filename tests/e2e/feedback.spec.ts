import { expect, test } from "@playwright/test";

import { messages } from "../../src/config/messages.es";

import { loginAs } from "./helpers/login";

const feedback = messages.dev.gallery.feedback;

test("a submit button shows it is busy and a wrong password appears as an error notice", async ({
  page,
}) => {
  // Se retrasa la respuesta del servidor para poder ver el botón mientras espera.
  await page.route("**/login", async (route) => {
    if (route.request().method() === "POST") {
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
    await route.continue();
  });

  await page.goto("/login");
  await page.getByLabel(messages.auth.login.username).fill("owner");
  await page.getByLabel(messages.auth.login.password).fill("una-clave-equivocada");
  await page.getByRole("button", { name: messages.auth.login.submit }).click();

  const busy = page.getByRole("button", { name: messages.auth.login.submitting });
  await expect(busy).toBeDisabled();
  await expect(busy).toHaveAttribute("aria-busy", "true");
  await expect(busy.locator("svg.animate-spin")).toHaveCount(1);

  const notice = page.getByRole("alert");
  await expect(notice).toBeVisible();
  await expect(notice.locator("svg")).toHaveCount(1); // el icono acompaña al color
  await expect(page.getByRole("button", { name: messages.auth.login.submit })).toBeEnabled();
});

test("the busy state is gone once the response arrives", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel(messages.auth.login.username).fill("owner");
  await page.getByLabel(messages.auth.login.password).fill("otra-clave-equivocada");
  await page.getByRole("button", { name: messages.auth.login.submit }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.locator("svg.animate-spin")).toHaveCount(0);
});

test("the gallery shows every notice tone with its icon, a busy button and a toast on demand", async ({
  page,
}) => {
  await loginAs(page, "owner");
  await page.goto("/dev/componentes");

  const notices = page.getByRole("region", { name: feedback.notices });
  await expect(notices.getByRole("alert")).toHaveCount(1);
  await expect(notices.getByRole("status")).toHaveCount(4);
  await expect(notices.locator("svg")).toHaveCount(5);

  const busy = page.getByRole("button", { name: feedback.loading });
  await expect(busy).toBeDisabled();
  await expect(busy).toHaveAttribute("aria-busy", "true");

  await page.getByRole("button", { name: feedback.toastSuccess }).click();
  await expect(page.getByText(feedback.toastMessage, { exact: true })).toBeVisible();
});
