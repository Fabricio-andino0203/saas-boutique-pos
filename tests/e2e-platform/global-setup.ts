import { execFileSync } from "node:child_process";

import { E2E_PASSWORD } from "./constants";

/**
 * Deja lista la base central de pruebas y da de alta al administrador de la prueba. Se hace con `tsx` en otro proceso
 * porque el cliente de Prisma generado usa `import.meta`, que no carga dentro del proceso de Playwright.
 */
export default function globalSetup(): void {
  const url = process.env.CONTROL_DATABASE_URL;
  if (!url) {
    throw new Error("Falta CONTROL_DATABASE_URL (la fija playwright.platform.config.ts).");
  }
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!name.endsWith("_test")) {
    throw new Error(`Las pruebas de la plataforma solo usan una base _test (recibida: ${name}).`);
  }

  const run = (script: string, extra: Record<string, string> = {}) =>
    execFileSync("pnpm", ["run", script], {
      stdio: "inherit",
      shell: true,
      env: { ...process.env, ...extra },
    });

  run("control:setup");
  const username = `e2e-${Math.random().toString(36).slice(2, 8)}`;
  run("platform:create-admin", {
    ADMIN_NAME: "Administrador de prueba",
    ADMIN_USERNAME: username,
    ADMIN_PASSWORD: E2E_PASSWORD,
  });
  // Dos negocios con el mismo usuario y datos distintos, para las pruebas de aislamiento (tenants.spec.ts).
  execFileSync("pnpm", ["exec", "tsx", "tests/e2e-platform/setup-tenants.ts"], {
    stdio: "inherit",
    shell: true,
    env: process.env,
  });
  // Los procesos de prueba que se lanzan después heredan este valor.
  process.env.PLATFORM_E2E_USER = username;
}
