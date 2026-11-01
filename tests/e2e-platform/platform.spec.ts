import { expect, test, type Page } from "@playwright/test";

import { platformMessages } from "../../src/config/messages.platform.es";
import { totpCode, totpStep } from "../../src/lib/totp";
import { E2E_PASSWORD as PASSWORD, TENANTS } from "./constants";

const copy = platformMessages;
// `global-setup.ts` da de alta al administrador en otro proceso (el cliente de Prisma no carga dentro de Playwright).
const username = process.env.PLATFORM_E2E_USER ?? "";
const suffix = username.replace(/^e2e-/, "");

/**
 * Un código que el servidor aceptará: el del intervalo actual o, si ese ya se usó, el del siguiente (el servidor tolera un
 * intervalo de adelanto). Un código no se acepta dos veces, así que una prueba no puede entrar más de dos veces por intervalo.
 */
function nextCode(secret: string, lastStep: number): { code: string; step: number } {
  const step = Math.max(totpStep(new Date()), lastStep + 1);
  return { code: totpCode(secret, step), step };
}

async function passwordStep(page: Page, user: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel(copy.login.username).fill(user);
  await page.getByLabel(copy.login.password).fill(password);
  await page.getByRole("button", { name: copy.login.submit }).click();
}

const summaryHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: copy.summary.title });
const alertWith = (page: Page, text: string) =>
  // `getByRole("alert")` también encuentra el anunciador de rutas de Next: se filtra por el texto.
  page.getByRole("alert").filter({ hasText: text });

test("sin sesión solo se ve la entrada, y las rutas de un negocio no existen aquí", async ({
  page,
}) => {
  await page.goto("/negocios");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: copy.login.title })).toBeVisible();

  // Se navega con el navegador (el que resuelve `*.localhost`): Node no lo hace.
  // La ruta interna no es una dirección pública, y un host que no es del panel ni de una tienda no responde.
  expect((await page.goto("/platform/login"))?.status()).toBe(404);
  const port = new URL(page.url()).port;
  expect((await page.goto(`http://localhost:${port}/login`))?.status()).toBe(404);
  expect((await page.goto(`http://127.0.0.1:${port}/`))?.status()).toBe(404);
  const health = await page.goto("/api/health");
  expect(health?.status()).toBe(200);
  expect(await health?.json()).toEqual({ status: "ok" });
});

test("contraseña incorrecta: mensaje claro y sin pasar al código", async ({ page }) => {
  await passwordStep(page, username, "contrasena-equivocada-123");
  await expect(alertWith(page, copy.errors.INVALID_CREDENTIALS)).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

// El resto es un solo recorrido con la misma sesión del navegador: cada acceso completo gasta un código.
test.describe.serial("recorrido completo del superadministrador", () => {
  let page: Page;
  let secret = "";
  let lastStep = 0;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
  });
  test.afterAll(async () => {
    await page.close();
  });

  test("primer acceso: QR y clave, código incorrecto y luego el correcto", async () => {
    await passwordStep(page, username, PASSWORD);
    await expect(page.getByRole("heading", { name: copy.enroll.title })).toBeVisible();
    await expect(page.getByRole("img", { name: copy.enroll.qrLabel })).toBeVisible();

    secret = ((await page.getByLabel(copy.enroll.secretLabel).textContent()) ?? "").replace(
      /\s/g,
      "",
    );
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);

    await page.getByLabel(copy.verify.code).fill("000000");
    await page.getByRole("button", { name: copy.enroll.submit }).click();
    await expect(alertWith(page, copy.errors.INVALID_CODE)).toBeVisible();

    const next = nextCode(secret, lastStep);
    lastStep = next.step;
    await page.getByLabel(copy.verify.code).fill(next.code);
    await page.getByRole("button", { name: copy.enroll.submit }).click();
    await expect(summaryHeading(page)).toBeVisible();
    await expect(page.getByText(`@${username}`).first()).toBeVisible();
  });

  test("negocios: el panel lista los negocios registrados con su dirección, su estado y su versión de datos", async () => {
    await page.getByRole("link", { name: copy.nav.tenants }).click();
    await expect(page.getByRole("heading", { level: 1, name: copy.tenants.title })).toBeVisible();
    for (const tenant of Object.values(TENANTS)) {
      const row = page.getByRole("row").filter({ hasText: tenant.name });
      await expect(row).toContainText(`${tenant.slug}.localhost`);
      await expect(row).toContainText(copy.tenants.status.ACTIVE);
    }
  });

  test("administradores: la confirmación con la contraseña protege el alta; la auditoría lo registra", async () => {
    await page.getByRole("link", { name: copy.nav.admins }).click();
    await expect(page.getByRole("heading", { level: 1, name: copy.admins.title })).toBeVisible();

    const create = copy.admins.create;
    await page.getByLabel(create.name, { exact: true }).fill("Segunda Persona");
    // La pantalla de entrada visitada antes sigue montada (oculta) y también tiene un campo "Usuario".
    await page.locator("#new-username").fill(`otra-${suffix}`);
    await page.getByLabel(create.password, { exact: true }).fill("temporal-larga-2026");
    await page.getByLabel(create.actorPassword).fill("no-es-mi-contrasena");
    await page.getByRole("button", { name: create.submit }).click();
    await expect(alertWith(page, copy.errors.INVALID_CREDENTIALS)).toBeVisible();
    // El error no borra lo que se había escrito (salvo las contraseñas).
    await expect(page.getByLabel(create.name, { exact: true })).toHaveValue("Segunda Persona");

    await page.getByLabel(create.password, { exact: true }).fill("temporal-larga-2026");
    await page.getByLabel(create.actorPassword).fill(PASSWORD);
    await page.getByRole("button", { name: create.submit }).click();
    await expect(page.getByText(create.success)).toBeVisible();
    // La lista se actualiza sola.
    await expect(page.getByRole("cell", { name: `@otra-${suffix}` })).toBeVisible();

    await page.getByRole("link", { name: copy.nav.audit }).click();
    await expect(page.getByRole("heading", { level: 1, name: copy.audit.title })).toBeVisible();
    for (const action of [
      "PLATFORM_USER_CREATED",
      "PLATFORM_LOGIN",
      "PLATFORM_2FA_ENABLED",
    ] as const) {
      await expect(
        page.getByRole("cell", { name: copy.audit.actions[action] }).first(),
      ).toBeVisible();
    }
  });

  test("cerrar sesión vuelve al panel de entrada (no a una tienda) y la sesión ya no sirve", async () => {
    await page.getByRole("button", { name: copy.nav.logout }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: copy.login.title })).toBeVisible();

    await page.goto("/administradores");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("segundo acceso: pide el código, y uno ya usado no sirve otra vez", async () => {
    await passwordStep(page, username, PASSWORD);
    await expect(page.getByRole("heading", { name: copy.verify.title })).toBeVisible();

    // El código con el que se activó la verificación ya se gastó.
    await page.getByLabel(copy.verify.code).fill(totpCode(secret, lastStep));
    await page.getByRole("button", { name: copy.verify.submit }).click();
    await expect(alertWith(page, copy.errors.INVALID_CODE)).toBeVisible();

    const next = nextCode(secret, lastStep);
    lastStep = next.step;
    await page.getByLabel(copy.verify.code).fill(next.code);
    await page.getByRole("button", { name: copy.verify.submit }).click();
    await expect(summaryHeading(page)).toBeVisible();
  });
});
