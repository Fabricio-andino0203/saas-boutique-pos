import "dotenv/config";

import { resolve } from "node:path";

import { defineConfig, devices } from "@playwright/test";

const port = 3100;
const isCI = Boolean(process.env.CI);

/**
 * `E2E_TENANCY=multi` corre exactamente las mismas pruebas con la tienda como el **negocio #1 de la plataforma**: el servidor
 * en modo multi-negocio, la base de las pruebas registrada como `tienda` en la base central de PRUEBAS y el navegador entrando
 * por `tienda.localhost`. Es la prueba de que «la tienda actual sigue vendiendo igual».
 */
const multi = process.env.E2E_TENANCY === "multi";
const baseURL = multi ? `http://tienda.localhost:${port}` : `http://127.0.0.1:${port}`;
// El servidor responde la salud de la plataforma en cualquier nombre que no sea de un negocio: sirve para esperar el arranque
// en ambos modos (Node no resuelve `*.localhost` en todos los sistemas, pero 127.0.0.1 siempre).
const healthURL = `http://127.0.0.1:${port}/api/health`;

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

const multiEnv: Record<string, string> = multi
  ? {
      TENANCY_MODE: "multi",
      TENANT_BASE_DOMAIN: "localhost",
      CONTROL_DATABASE_URL: controlTestUrl(),
      PLATFORM_MASTER_KEY: Buffer.alloc(32, 4).toString("base64url"),
    }
  : {};
if (multi) {
  // Los procesos de prueba (alta del negocio #1, limpieza) usan la misma base central que el servidor, y las peticiones de
  // Node a `tienda.localhost` se resuelven a 127.0.0.1 (ver el archivo).
  Object.assign(process.env, multiEnv);
  // Barras normales: NODE_OPTIONS trata la barra invertida como escape y rompería la ruta en Windows.
  const preload = resolve(__dirname, "tests/e2e/support/localhost-dns.cjs").split("\\").join("/");
  process.env.NODE_OPTIONS = [process.env.NODE_OPTIONS, `--require "${preload}"`]
    .filter(Boolean)
    .join(" ");
}

export default defineConfig({
  testDir: "tests/e2e",
  testIgnore: ["**/blueprints/**"],
  ...(multi ? { globalSetup: "./tests/e2e/global-setup-multi.ts" } : {}),
  globalTeardown: "./tests/e2e/global-teardown.ts",
  fullyParallel: true,
  // Las acciones del servidor tardan más cuando varios navegadores comparten servidor y base de datos.
  expect: { timeout: 15_000 },
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: [["list"]],
  use: { baseURL, trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm build && pnpm exec next start --port ${port}`,
    url: healthURL,
    reuseExistingServer: !isCI,
    timeout: 240_000,
    // Todas las pruebas inician sesión desde la misma IP: el límite de intentos fallidos por IP se sube para no estorbarles.
    env: { NEXT_PUBLIC_COMPONENT_GALLERY: "enabled", LOGIN_RATE_LIMIT_MAX: "1000", ...multiEnv },
  },
});
