import { execFileSync } from "node:child_process";

/**
 * Borra los datos que crean las pruebas E2E (usuarios `e2e-*` y catálogos "E2E …"). Se ejecuta con
 * `tsx` en otro proceso porque el cliente de Prisma generado usa `import.meta`, que no carga
 * dentro del proceso de Playwright.
 */
export function deleteE2eData(): void {
  execFileSync("pnpm", ["exec", "tsx", "scripts/cleanup-e2e-data.ts"], {
    stdio: "inherit",
    shell: true,
  });
}
