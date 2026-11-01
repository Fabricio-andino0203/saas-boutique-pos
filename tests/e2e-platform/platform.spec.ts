import { expect, test, type Page } from "@playwright/test";

import { messages } from "../../src/config/messages.es";
import { platformMessages } from "../../src/config/messages.platform.es";
import { totpCode, totpStep } from "../../src/lib/totp";
import { E2E_PASSWORD as PASSWORD, PLATFORM_E2E_PORT, TENANTS } from "./constants";

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

  // Un negocio dado de alta desde el panel: lo usan las tres pruebas siguientes (el alta tarda unos segundos).
  const newSlug = `panel-${suffix}`;
  const newName = `Boutique del panel ${suffix}`;
  const newOwnerPassword = "Temporal-del-panel-2026";
  const newTenantUrl = `http://${newSlug}.localhost:${PLATFORM_E2E_PORT}`;
  const detailHeading = (page: Page) => page.getByRole("heading", { level: 1, name: newName });

  test("alta de un negocio desde el panel: se crea con su base, queda activo y su propietario puede entrar", async ({
    browser,
  }) => {
    test.slow();
    const create = copy.tenants.create;
    await page.getByRole("link", { name: copy.nav.tenants }).click();
    await expect(page.getByRole("heading", { level: 2, name: create.title })).toBeVisible();

    // Una contraseña de confirmación equivocada no crea nada.
    await page.locator("#tenant-name").fill(newName);
    await page.locator("#tenant-slug").fill(newSlug);
    await page.locator("#tenant-owner-name").fill("Rosa Pérez");
    await page.locator("#tenant-owner-username").fill("rosa");
    await page.locator("#tenant-owner-password").fill(newOwnerPassword);
    await page.locator("#tenant-actor-password").fill("no-es-mi-contrasena");
    await page.getByRole("button", { name: create.submit }).click();
    await expect(alertWith(page, copy.errors.INVALID_CREDENTIALS)).toBeVisible();
    await expect(page.locator("#tenant-name")).toHaveValue(newName); // lo escrito se conserva

    // Un subdominio reservado se explica con claridad.
    await page.locator("#tenant-slug").fill("admin");
    await page.locator("#tenant-owner-password").fill(newOwnerPassword);
    await page.locator("#tenant-actor-password").fill(PASSWORD);
    await page.getByRole("button", { name: create.submit }).click();
    await expect(alertWith(page, "está reservado")).toBeVisible();

    await page.locator("#tenant-slug").fill(newSlug);
    await page.locator("#tenant-owner-password").fill(newOwnerPassword);
    await page.locator("#tenant-actor-password").fill(PASSWORD);
    await page.getByRole("button", { name: create.submit }).click();

    // Termina en el detalle del negocio, activo y con los siete pasos hechos.
    await expect(page).toHaveURL(new RegExp(`/negocios/${newSlug}$`), { timeout: 90_000 });
    await expect(detailHeading(page)).toBeVisible();
    await expect(page.getByText(copy.tenants.status.ACTIVE).first()).toBeVisible();
    await expect(page.getByText(copy.tenants.detail.stepStatus.DONE)).toHaveCount(7);
    await expect(page.getByText(copy.tenants.detail.runStatus.SUCCEEDED)).toBeVisible();

    // El propietario entra a su dirección con la contraseña temporal (otra pestaña: no se pierde la sesión del panel).
    const ownerPage = await browser.newPage();
    try {
      await ownerPage.goto(`${newTenantUrl}/login`);
      await ownerPage.getByLabel(messages.auth.login.username).fill("rosa");
      await ownerPage.getByLabel(messages.auth.login.password).fill(newOwnerPassword);
      await ownerPage.getByRole("button", { name: messages.auth.login.submit }).click();
      await expect(
        ownerPage.getByRole("heading", { level: 1, name: messages.home.title }),
      ).toBeVisible();
    } finally {
      await ownerPage.close();
    }
  });

  test("suspender y reactivar desde el panel; una contraseña equivocada no cambia nada", async ({
    browser,
  }) => {
    const actions = copy.tenants.actions;
    await page.goto(`/negocios/${newSlug}`);
    await expect(detailHeading(page)).toBeVisible();

    const open = async (label: string) => {
      await page.getByText(label, { exact: true }).first().click();
    };
    await open(actions.suspend);
    await page.locator(`#confirm-suspend-${newSlug}`).fill("no-es-mi-contrasena");
    await page.getByRole("button", { name: actions.suspend }).click();
    await expect(alertWith(page, copy.errors.INVALID_CREDENTIALS)).toBeVisible();

    await page.locator(`#confirm-suspend-${newSlug}`).fill(PASSWORD);
    await page.getByRole("button", { name: actions.suspend }).click();
    await expect(page.getByText(actions.done.suspend)).toBeVisible();
    await expect(page.getByText(copy.tenants.status.SUSPENDED).first()).toBeVisible();

    const visitor = await browser.newPage();
    try {
      await expect
        .poll(async () => (await visitor.goto(`${newTenantUrl}/login`))?.status(), {
          timeout: 10_000,
        })
        .toBe(403);
      await expect(
        visitor.getByRole("heading", { name: copy.unavailable.suspended.title }),
      ).toBeVisible();

      await open(actions.reactivate);
      await page.locator(`#confirm-reactivate-${newSlug}`).fill(PASSWORD);
      await page.getByRole("button", { name: actions.reactivate }).click();
      await expect(page.getByText(actions.done.reactivate)).toBeVisible();
      await expect
        .poll(async () => (await visitor.goto(`${newTenantUrl}/login`))?.status(), {
          timeout: 10_000,
        })
        .toBe(200);
    } finally {
      await visitor.close();
    }
  });

  test("la baja controlada: se pide con un motivo, no se archiva antes de tiempo sin decirlo y se puede cancelar", async () => {
    const actions = copy.tenants.actions;
    await page.goto(`/negocios/${newSlug}`);
    await page.getByText(actions.requestDeletion, { exact: true }).first().click();
    await page.locator(`#reason-${newSlug}`).fill("Prueba de baja desde el panel");
    await page.locator(`#confirm-requestDeletion-${newSlug}`).fill(PASSWORD);
    await page.getByRole("button", { name: actions.requestDeletion }).click();
    await expect(page.getByText(actions.done.requestDeletion)).toBeVisible();
    await expect(page.getByText(copy.tenants.detail.pendingDeletion)).toBeVisible();
    await expect(page.getByText("Prueba de baja desde el panel")).toBeVisible();

    // Archivar exige escribir el subdominio y, antes de que termine la retención, aceptar que es anticipado.
    await page.getByText(actions.archive, { exact: true }).first().click();
    await page.locator(`#confirm-slug-${newSlug}`).fill(newSlug);
    await page.locator(`#confirm-archive-${newSlug}`).fill(PASSWORD);
    await page.getByRole("button", { name: actions.archive }).click();
    await expect(alertWith(page, "retención termina")).toBeVisible();

    await page.getByText(actions.cancelDeletion, { exact: true }).first().click();
    await page.locator(`#confirm-cancelDeletion-${newSlug}`).fill(PASSWORD);
    await page.getByRole("button", { name: actions.cancelDeletion }).click();
    await expect(page.getByText(actions.done.cancelDeletion)).toBeVisible();
    await expect(page.getByText(copy.tenants.status.ACTIVE).first()).toBeVisible();
  });

  test("planes y suscripciones: un plan se crea, se asigna, y la tienda lo siente (módulos, límites, solo lectura) hasta que se paga", async ({
    browser,
  }) => {
    test.slow();
    const billing = copy.billing;
    const sub = billing.subscription;
    const planName = `Plan E2E ${suffix}`;

    // ── El plan: un precio inválido lo explica sin borrar lo escrito (ni los módulos marcados); con uno válido aparece en la lista ──
    // (Cada contraseña equivocada cuenta para el bloqueo de la cuenta: en este recorrido solo caben cuatro, y ya se usan varias.)
    await page.getByRole("link", { name: copy.nav.plans }).click();
    await expect(page.getByRole("heading", { level: 1, name: billing.plans.title })).toBeVisible();
    await page.getByRole("link", { name: billing.plans.new }).first().click();
    await expect(
      page.getByRole("heading", { level: 1, name: billing.plans.newTitle }),
    ).toBeVisible();
    await page.locator("#plan-name").fill(planName);
    await page.locator("#plan-price").fill("abc");
    await page.locator("#plan-limitUsers").fill("2");
    await page.getByLabel(billing.features.customers).check();
    await page.locator("#plan-actor-password").fill(PASSWORD);
    await page.getByRole("button", { name: billing.plans.form.submitCreate }).click();
    await expect(alertWith(page, billing.validation.price)).toBeVisible();
    await expect(page.locator("#plan-name")).toHaveValue(planName); // lo escrito se conserva
    await expect(page.locator("#plan-limitUsers")).toHaveValue("2");
    await expect(page.getByLabel(billing.features.customers)).toBeChecked(); // y los módulos marcados

    await page.locator("#plan-price").fill("500.00");
    await page.locator("#plan-actor-password").fill(PASSWORD);
    await page.getByRole("button", { name: billing.plans.form.submitCreate }).click();
    await expect(page).toHaveURL(/\/planes$/);
    const planRow = page.getByTestId(`plan-row-${planName}`);
    await expect(planRow).toContainText("L 500.00");
    await expect(planRow).toContainText(billing.features.customers);
    await expect(planRow).not.toContainText(billing.features.reports);

    // ── Se asigna a un negocio con el vencimiento ya pasado: queda en solo lectura ──
    const daysAgo = (days: number) =>
      new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    await page.goto(`/negocios/${newSlug}`);
    await expect(page.getByTestId("subscription-none")).toBeVisible();
    await page.getByTestId("billing-assign").locator("summary").click();
    await page.locator("#assign-plan").selectOption({ label: planName });
    await page.locator("#assign-mode").selectOption("paid");
    await page.locator("#assign-until").fill(daysAgo(20));
    await page.locator("#assign-reason").fill("Prueba de navegador");
    await page.locator("#billing-assign-password").fill(PASSWORD);
    await page.getByRole("button", { name: sub.assign.submit }).click();
    // El formulario de asignar desaparece al refrescar (ya hay plan), y con él su mensaje: lo que se comprueba es el resultado.
    await expect(page.getByTestId("subscription-facts")).toHaveAttribute("data-mode", "readonly");

    // ── La tienda: aviso de solo lectura, el menú sin lo que el plan no incluye, y nada nuevo se puede registrar ──
    const store = await browser.newPage();
    try {
      await store.goto(`${newTenantUrl}/login`);
      await store.getByLabel(messages.auth.login.username).fill("rosa");
      await store.getByLabel(messages.auth.login.password).fill(newOwnerPassword);
      await store.getByRole("button", { name: messages.auth.login.submit }).click();
      await expect(
        store.getByRole("heading", { level: 1, name: messages.home.title }),
      ).toBeVisible();

      const banner = store.getByTestId("subscription-banner");
      await expect(banner).toHaveAttribute("data-mode", "readonly");
      await expect(banner).toContainText("Solo lectura");
      await expect(
        store.getByRole("link", { name: messages.nav.customers, exact: true }),
      ).toBeVisible();
      await expect(
        store.getByRole("link", { name: messages.nav.reports, exact: true }),
      ).toHaveCount(0);
      await expect(
        store.getByRole("link", { name: messages.nav.layaways, exact: true }),
      ).toHaveCount(0);

      // Un módulo que el plan no incluye no responde, ni con la dirección escrita a mano.
      const blocked = await store.goto(`${newTenantUrl}/reportes`);
      expect(blocked?.status()).toBe(403);
      await expect(
        store.getByRole("heading", { name: copy.unavailable.feature.title }),
      ).toBeVisible();

      // Consultar sí; registrar algo nuevo, no.
      await store.goto(`${newTenantUrl}/usuarios`);
      await expect(
        store.getByRole("heading", { level: 1, name: messages.users.title }),
      ).toBeVisible();
      await store.goto(`${newTenantUrl}/usuarios/nuevo`);
      await store.getByLabel(messages.users.form.name).fill("Persona de prueba");
      await store.getByLabel(messages.users.form.username, { exact: true }).fill(`p-${suffix}`);
      await store.getByLabel(messages.users.form.password).fill("Clave-E2E-2026");
      await store.getByRole("button", { name: messages.users.form.create }).click();
      await expect(store.getByText(messages.errors.READ_ONLY)).toBeVisible();

      // ── El pago: el panel lo registra y la tienda vuelve a poder trabajar, sin perder nada ──
      await page.reload();
      await page.getByTestId("billing-pay").locator("summary").click();
      // Un monto inválido se explica sin borrar lo demás (una contraseña equivocada también contaría para el bloqueo de la cuenta).
      await page.locator("#pay-amount").fill("abc");
      await page.locator("#pay-reference").fill("TR-E2E-1");
      await page.locator("#billing-pay-password").fill(PASSWORD);
      await page.getByRole("button", { name: sub.pay.submit }).click();
      await expect(alertWith(page, copy.billing.validation.amount)).toBeVisible();
      await expect(page.locator("#pay-reference")).toHaveValue("TR-E2E-1");
      await expect(page.locator("#billing-pay-password")).toHaveValue(""); // solo se vacía la contraseña
      await page.locator("#pay-amount").fill("500.00");
      await page.locator("#billing-pay-password").fill(PASSWORD);
      await page.getByRole("button", { name: sub.pay.submit }).click();
      await expect(
        page.getByText(/Pago registrado: el negocio queda cubierto hasta el/),
      ).toBeVisible();
      await expect(page.getByTestId("subscription-facts")).toHaveAttribute("data-mode", "full");
      await expect(page.getByRole("cell", { name: "TR-E2E-1" })).toBeVisible();

      await expect
        .poll(
          async () => {
            await store.goto(`${newTenantUrl}/usuarios`);
            return store.getByTestId("subscription-banner").count();
          },
          { timeout: 10_000 },
        )
        .toBe(0);

      // ── El límite del plan (2 usuarios): con la dueña caben uno más, y el siguiente se rechaza ──
      await expect(store.getByTestId("plan-usage-users")).toContainText("1 de 2 usuarios");
      await store.goto(`${newTenantUrl}/usuarios/nuevo`);
      await store.getByLabel(messages.users.form.name).fill("Persona de prueba");
      await store.getByLabel(messages.users.form.username, { exact: true }).fill(`p-${suffix}`);
      await store.getByLabel(messages.users.form.password).fill("Clave-E2E-2026");
      await store.getByRole("button", { name: messages.users.form.create }).click();
      await expect(store).toHaveURL(/\/usuarios$/);
      await expect(store.getByTestId("plan-usage-users")).toContainText("2 de 2 usuarios");

      await store.goto(`${newTenantUrl}/usuarios/nuevo`);
      await store.getByLabel(messages.users.form.name).fill("Otra persona");
      await store.getByLabel(messages.users.form.username, { exact: true }).fill(`q-${suffix}`);
      await store.getByLabel(messages.users.form.password).fill("Clave-E2E-2026");
      await store.getByRole("button", { name: messages.users.form.create }).click();
      await expect(store.getByText(messages.errors.PLAN_LIMIT)).toBeVisible();
    } finally {
      await store.close();
    }

    // ── Todo quedó en la auditoría de la plataforma ──
    await page.goto("/auditoria");
    for (const action of [
      "PLAN_CREATED",
      "SUBSCRIPTION_ASSIGNED",
      "SUBSCRIPTION_PAYMENT_REGISTERED",
    ] as const) {
      await expect(
        page.getByRole("cell", { name: copy.audit.actions[action] }).first(),
      ).toBeVisible();
    }
  });

  test("revisión del servidor: muestra qué revisar y actualiza los datos de todos los negocios", async () => {
    const review = copy.tenants.review;
    await page.goto("/negocios/revision");
    await expect(page.getByRole("heading", { level: 1, name: review.title })).toBeVisible();
    await page.locator("#fleet-password").fill(PASSWORD);
    await page.getByRole("button", { name: review.migrateAll.submit }).click();
    await expect(
      page.getByText(/Migrados \d+, al día \d+, con error 0, sin tocar 0\./),
    ).toBeVisible();
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
