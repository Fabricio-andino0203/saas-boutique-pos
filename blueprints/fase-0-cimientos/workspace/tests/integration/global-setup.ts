import "dotenv/config";

import { execSync } from "node:child_process";

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

export default function setup(): void {
  const databaseUrl = assertTestDatabaseUrl(process.env.DATABASE_URL_TEST);
  execSync("pnpm exec prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}
