import "dotenv/config";

import { execSync } from "node:child_process";

import { ensureDatabase } from "../../src/lib/tenancy/provision-db";
import { controlTestUrl } from "./helpers/control-url";

function assertTestDatabaseUrl(url: string | undefined): string {
  if (!url) {
    throw new Error("DATABASE_URL_TEST no está definida (revisa .env).");
  }
  const databaseName = new URL(url).pathname.replace(/^\//, "");
  if (!databaseName.endsWith("_test")) {
    throw new Error(`La base de pruebas debe terminar en _test (recibida: ${databaseName}).`);
  }
  return url;
}

export default async function setup(): Promise<void> {
  const databaseUrl = assertTestDatabaseUrl(process.env.DATABASE_URL_TEST);
  execSync("pnpm exec prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });

  // Base central de la plataforma (Etapa 1): se crea si falta y se migra, igual que la del negocio.
  const controlUrl = controlTestUrl();
  await ensureDatabase(controlUrl, new URL(controlUrl).pathname.replace(/^\//, ""));
  execSync("pnpm exec prisma migrate deploy --config prisma/control/prisma.config.ts", {
    stdio: "inherit",
    env: { ...process.env, CONTROL_DATABASE_URL: controlUrl },
  });
}
