import "dotenv/config";

import { execSync } from "node:child_process";

import { ensureDatabase } from "../src/lib/tenancy/provision-db";

/**
 * Deja lista la base CENTRAL de la plataforma: la crea si no existe y le aplica las migraciones de `prisma/control/`.
 * Es seguro repetirlo (el arranque del contenedor lo corre en cada inicio en modo multi-negocio).
 *
 *   pnpm control:setup
 *
 * Si la cuenta no puede crear bases (un Postgres administrado donde la base ya existe), la creación se omite y solo se migra.
 */
async function main(): Promise<void> {
  const url = process.env.CONTROL_DATABASE_URL;
  if (!url) {
    throw new Error("Falta CONTROL_DATABASE_URL (la base central de la plataforma).");
  }
  const name = new URL(url).pathname.replace(/^\//, "");

  try {
    const created = await ensureDatabase(url, name);
    console.log(created ? `Base central "${name}" creada.` : `Base central "${name}" ya existía.`);
  } catch (error) {
    console.warn(
      `No se pudo comprobar o crear la base central "${name}" (${error instanceof Error ? error.message : error}); se intenta migrar tal cual.`,
    );
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
