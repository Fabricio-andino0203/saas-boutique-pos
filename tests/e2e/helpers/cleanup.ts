import { execFileSync } from "node:child_process";

/**
 * Borra los usuarios `e2e-*` de la base. Se ejecuta con `tsx` en otro proceso porque el cliente de
 * Prisma generado usa `import.meta`, que no carga dentro del proceso de Playwright.
 */
export function deleteE2eUsers(): void {
  execFileSync("pnpm", ["exec", "tsx", "scripts/cleanup-e2e-users.ts"], {
    stdio: "inherit",
    shell: true,
  });
}
