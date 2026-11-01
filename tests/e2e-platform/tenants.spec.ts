import { execFileSync } from "node:child_process";

import { expect, test, type Page } from "@playwright/test";

import { messages } from "../../src/config/messages.es";
import { platformMessages } from "../../src/config/messages.platform.es";
import { E2E_PASSWORD, OWNER_USERNAME, PLATFORM_E2E_PORT, TENANTS } from "./constants";

/**
 * Etapa 2: dos negocios en el mismo servidor, cada uno en su subdominio y con su base. Los dos tienen el MISMO usuario y la
 * MISMA contraseña; lo único distinto es el nombre del negocio. Se navega por `<subdominio>.localhost`, que Chromium resuelve
 * solo (Node no lo hace, por eso nada de esto usa peticiones fuera del navegador).
 */
const urlOf = (slug: string, path = "") => `http://${slug}.localhost:${PLATFORM_E2E_PORT}${path}`;
const { a, b } = TENANTS;
const suspended = platformMessages.unavailable.suspended;

async function login(page: Page, slug: string): Promise<void> {
  await page.goto(urlOf(slug, "/login"));
  await page.getByLabel(messages.auth.login.username).fill(OWNER_USERNAME);
  await page.getByLabel(messages.auth.login.password).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: messages.auth.login.submit }).click();
  await expect(page.getByRole("heading", { level: 1, name: messages.home.title })).toBeVisible();
}

async function businessName(page: Page, slug: string): Promise<string> {
  await page.goto(urlOf(slug, "/configuracion"));
  return page.getByLabel(messages.settings.business.legalName, { exact: true }).inputValue();
}

/** Cambia el estado de un negocio desde la línea de comandos (otro proceso, como lo haría quien opera el servicio). */
function platformCommand(command: "suspend" | "reactivate", slug: string): void {
  execFileSync("pnpm", ["run", `platform:${command}`, slug], {
    stdio: "pipe",
    shell: true,
    env: process.env,
  });
}

test("each business answers at its own address with its own data", async ({ page }) => {
  await login(page, a.slug);
  expect(await businessName(page, a.slug)).toBe(a.name);

  // El mismo usuario y contraseña, en el otro negocio: otra base, otro nombre.
  await login(page, b.slug);
  expect(await businessName(page, b.slug)).toBe(b.name);
  expect(await businessName(page, a.slug)).toBe(a.name);
});

test("a session of one business does not open the other, even with the cookie copied over", async ({
  page,
  context,
}) => {
  await login(page, a.slug);
  const cookies = await context.cookies(urlOf(a.slug));
  const session = cookies.find((cookie) => cookie.name === "boutique_session");
  expect(session, "la cookie de sesión de A").toBeDefined();

  // Se copia tal cual al otro negocio (lo que haría alguien que roba una cookie): el token no existe en su base.
  await context.addCookies([
    { name: "boutique_session", value: session?.value ?? "", url: urlOf(b.slug) },
  ]);
  await page.goto(urlOf(b.slug, "/configuracion"));
  await expect(page).toHaveURL(/\/login(\?|$)/);
  await expect(page.getByRole("heading", { name: messages.auth.login.title })).toBeVisible();

  // Y A sigue abierto.
  expect(await businessName(page, a.slug)).toBe(a.name);
});

test("an address that is not a business, and the panel's internal route, answer 404", async ({
  page,
}) => {
  for (const url of [
    urlOf("nadie", "/login"),
    urlOf("nadie", "/"),
    urlOf("admin-falso", "/login"),
    `http://localhost:${PLATFORM_E2E_PORT}/login`,
    urlOf(a.slug, "/platform"),
    urlOf(a.slug, "/platform/negocios"),
  ]) {
    expect((await page.goto(url))?.status(), url).toBe(404);
  }
  // El estado del servicio sí contesta en cualquier dirección: la plataforma está en pie.
  const health = await page.goto(urlOf("nadie", "/api/health"));
  expect(health?.status()).toBe(200);
});

test("Caddy's certificate question says yes only for the panel and for businesses that exist", async ({
  page,
}) => {
  // Caddy la hace por la red interna; aquí se hace desde el navegador porque el proxy deja pasar esa ruta en cualquier host.
  const ask = async (domain: string) =>
    (
      await page.goto(
        `http://localhost:${PLATFORM_E2E_PORT}/api/internal/tls-allowed?domain=${encodeURIComponent(domain)}`,
      )
    )?.status();
  expect(await ask("admin.localhost")).toBe(200);
  expect(await ask(`${a.slug}.localhost`)).toBe(200);
  expect(await ask(`${b.slug}.localhost`)).toBe(200);
  for (const nobody of ["nadie.localhost", "evil.com", `${a.slug}.localhost.evil.com`, ""]) {
    expect(await ask(nobody), nobody).toBe(404);
  }
});

test("the health check answers for a business with its own database", async ({ page }) => {
  const response = await page.goto(urlOf(a.slug, "/api/health"));
  expect(response?.status()).toBe(200);
  expect(await response?.json()).toEqual({ status: "ok" });
});

test("a suspended business shows the suspended page while the other keeps selling; reactivating restores it", async ({
  page,
}) => {
  await login(page, a.slug);
  await login(page, b.slug);

  platformCommand("suspend", b.slug);
  try {
    // La caché del directorio es de 300 ms en estas pruebas: la suspensión se nota casi de inmediato.
    await expect
      .poll(async () => (await page.goto(urlOf(b.slug, "/")))?.status(), { timeout: 10_000 })
      .toBe(403);
    await expect(page.getByRole("heading", { name: suspended.title })).toBeVisible();
    await expect(page.getByText(suspended.body)).toBeVisible();
    // Ni la entrada ni ninguna otra pantalla de B responden, aunque la sesión siga viva.
    expect((await page.goto(urlOf(b.slug, "/login")))?.status()).toBe(403);
    expect((await page.goto(urlOf(b.slug, "/configuracion")))?.status()).toBe(403);

    // El otro negocio no se entera.
    expect((await page.goto(urlOf(a.slug, "/configuracion")))?.status()).toBe(200);
    expect(
      await page.getByLabel(messages.settings.business.legalName, { exact: true }).inputValue(),
    ).toBe(a.name);
  } finally {
    platformCommand("reactivate", b.slug);
  }

  await expect
    .poll(async () => (await page.goto(urlOf(b.slug, "/configuracion")))?.status(), {
      timeout: 10_000,
    })
    .toBe(200);
  // Nada se perdió: la sesión de antes y los datos siguen ahí.
  expect(
    await page.getByLabel(messages.settings.business.legalName, { exact: true }).inputValue(),
  ).toBe(b.name);
});
