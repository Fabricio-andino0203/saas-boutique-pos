import "dotenv/config";

import { defineConfig } from "vitest/config";

// Base central de la plataforma para las pruebas (Etapa 1): si no se define, se deriva de DATABASE_URL_TEST
// (`…_test` → `…_control_test`). Se fija en el entorno del proceso para que también la vea `globalSetup`.
if (!process.env.CONTROL_DATABASE_URL_TEST && process.env.DATABASE_URL_TEST) {
  const derived = new URL(process.env.DATABASE_URL_TEST);
  derived.pathname = derived.pathname.replace(/_test$/, "_control_test");
  process.env.CONTROL_DATABASE_URL_TEST = derived.toString();
}
// Llave maestra de pruebas: igual a `TEST_MASTER_KEY` de tests/integration/helpers/control-url.ts. No protege nada real.
const TEST_MASTER_KEY = Buffer.alloc(32, 7).toString("base64url");

const exclude = ["**/node_modules/**", "blueprints/**"];

const sharedEnv = {
  AUTH_SECRET: "vitest-only-secret-with-at-least-32-characters",
  APP_URL: "http://localhost:3000",
  // Las pruebas no necesitan el ruido del registro; las del logger lo activan a propósito.
  LOG_LEVEL: "silent",
};

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    exclude,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/lib/money.ts"],
      thresholds: {
        "src/lib/money.ts": {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 95,
        },
      },
    },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          exclude,
          environment: "node",
          env: {
            ...sharedEnv,
            DATABASE_URL: "postgresql://unit:unit@localhost:5432/unit_placeholder",
          },
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          exclude,
          environment: "node",
          fileParallelism: false,
          globalSetup: ["./tests/integration/global-setup.ts"],
          // Con TENANCY_MODE=multi deja a toda la suite trabajando como un negocio fijo (ver el archivo).
          setupFiles: ["./tests/integration/setup-tenant.ts"],
          testTimeout: 30_000,
          hookTimeout: 60_000,
          env: {
            ...sharedEnv,
            DATABASE_URL: process.env.DATABASE_URL_TEST ?? "",
            // Base central de la plataforma y llave maestra de prueba (Etapa 1). Nunca las de desarrollo.
            CONTROL_DATABASE_URL: process.env.CONTROL_DATABASE_URL_TEST ?? "",
            PLATFORM_MASTER_KEY: TEST_MASTER_KEY,
            // Con TENANCY_MODE=multi (la corrida estricta) el dominio de los negocios es obligatorio; las pruebas usan `localhost`.
            TENANT_BASE_DOMAIN: "localhost",
          },
        },
      },
    ],
  },
});
