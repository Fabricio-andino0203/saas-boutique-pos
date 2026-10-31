import "dotenv/config";

import { defineConfig } from "vitest/config";

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
          },
        },
      },
    ],
  },
});
