import "dotenv/config";

import { execSync } from "node:child_process";

import { ensureDatabase } from "../src/lib/tenancy/provision-db";

/**
 * Deja lista la base CENTRAL de la plataforma: la crea si no existe (solo en local) y le aplica las migraciones de
 * `prisma/control/`. En producción la base la crea el servidor de Postgres y este script solo migra.
 *
 *   pnpm control:setup
 */
async function main(): Promise<void> {
  const url = process.env.CONTROL_DATABASE_URL;
  if (!url) {
    throw new Error("Falta CONTROL_DATABASE_URL (la base central de la plataforma).");
  }
  const name = new URL(url).pathname.replace(/^\//, "");

  if (process.env.DEPLOYMENT !== "production") {
    const created = await ensureDatabase(url, name);
    console.log(created ? `Base central "${name}" creada.` : `Base central "${name}" ya existía.`);
  }
  execSync("pnpm exec prisma migrate deploy --config prisma/control/prisma.config.ts", {
    stdio: "inherit",
    env: process.env,
  });
  console.log("Base central lista.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
