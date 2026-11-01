import { execFileSync } from "node:child_process";

/** Quita los negocios de prueba (sus bases y sus filas en la base central de pruebas). */
export default function globalTeardown(): void {
  execFileSync("pnpm", ["exec", "tsx", "tests/e2e-platform/setup-tenants.ts", "--drop"], {
    stdio: "inherit",
    shell: true,
    env: process.env,
  });
}
