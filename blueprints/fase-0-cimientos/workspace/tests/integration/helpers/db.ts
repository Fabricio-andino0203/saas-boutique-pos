import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

export function assertTestDatabaseUrl(url: string | undefined): string {
  if (!url) {
    throw new Error("DATABASE_URL_TEST no está definida (revisa .env).");
  }
  const databaseName = new URL(url).pathname.replace(/^\//, "");
  if (!databaseName.endsWith("_test")) {
    throw new Error(`La base de pruebas debe terminar en _test (recibida: ${databaseName}).`);
  }
  return url;
}

const connectionString = assertTestDatabaseUrl(process.env.DATABASE_URL_TEST);

export const testDb = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

export async function resetDatabase(): Promise<void> {
  const rows = await testDb.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (rows.length === 0) {
    return;
  }
  const tables = rows.map((row) => `"${row.tablename}"`).join(", ");
  await testDb.$executeRawUnsafe(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
}

export async function closeDatabase(): Promise<void> {
  await testDb.$disconnect();
}
