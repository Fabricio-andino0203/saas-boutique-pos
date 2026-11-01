import { execFileSync } from "node:child_process";

/** E2E_TENANCY=multi: deja lista la base central de pruebas y registra la tienda de las pruebas como el negocio #1. */
export default function globalSetup(): void {
  const run = (args: string[]) =>
    execFileSync("pnpm", args, { stdio: "inherit", shell: true, env: process.env });
  run(["run", "control:setup"]);
  run(["exec", "tsx", "tests/e2e/helpers/adopt-e2e-store.ts"]);
}
