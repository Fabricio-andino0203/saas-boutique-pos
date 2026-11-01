import "dotenv/config";

import { defineConfig, devices } from "@playwright/test";

/**
 * Pruebas de navegador del panel de la plataforma (superadministradores). Van aparte de las de la tienda porque el panel
 * solo existe en modo multi-negocio y se abre por su propio host (`admin.localhost`, que Chromium resuelve solo):
 *
 *   pnpm test:e2e:platform
 *
 * Usan la base central de PRUEBAS (`…_control_test`), nunca la de desarrollo.
 */
const port = 3200;
const host = `admin.localhost:${port}`;
const baseURL = `http://${host}`;
const isCI = Boolean(process.env.CI);

function controlTestUrl(): string {
  if (process.env.CONTROL_DATABASE_URL_TEST) {
    return process.env.CONTROL_DATABASE_URL_TEST;
  }
  const source = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL;
  if (!source) {
    throw new Error("Falta DATABASE_URL_TEST (o CONTROL_DATABASE_URL_TEST) en el entorno.");
  }
  const url = new URL(source);
  url.pathname = url.pathname.replace(/(_test)?$/, "_control_test");
  return url.toString();
}

const controlUrl = controlTestUrl();
const masterKey = Buffer.alloc(32, 3).toString("base64url");

// Los procesos de prueba (que dan de alta al administrador) usan la misma base central que el servidor.
process.env.CONTROL_DATABASE_URL = controlUrl;
process.env.PLATFORM_MASTER_KEY = masterKey;
// Los negocios de prueba se crean en el mismo servidor de Postgres que usa la suite de integración.
if (!process.env.DATABASE_URL_TEST) {
  throw new Error("Falta DATABASE_URL_TEST en el entorno.");
}

export default defineConfig({
  testDir: "tests/e2e-platform",
  globalSetup: "./tests/e2e-platform/global-setup.ts",
  globalTeardown: "./tests/e2e-platform/global-teardown.ts",
  fullyParallel: false,
  workers: 1,
  expect: { timeout: 15_000 },
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: [["list"]],
  use: { baseURL, trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm build && pnpm exec next start --port ${port}`,
    // El host del panel no se resuelve desde Node: se espera a que el puerto responda.
    port,
    reuseExistingServer: !isCI,
    timeout: 240_000,
    env: {
      TENANCY_MODE: "multi",
      PLATFORM_HOST: "admin.localhost",
      // Los negocios de prueba viven en <subdominio>.localhost (Chromium lo resuelve solo). Caché corta del directorio para que
      // una suspensión se note en menos de un segundo.
      TENANT_BASE_DOMAIN: "localhost",
      TENANT_DIRECTORY_TTL_MS: "300",
      CONTROL_DATABASE_URL: controlUrl,
      PLATFORM_MASTER_KEY: masterKey,
      PLATFORM_LOGIN_RATE_LIMIT_MAX: "1000",
      LOGIN_RATE_LIMIT_MAX: "1000",
    },
  },
});
