import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/control/client";
import { controlTestUrl } from "./control-url";

/** Cliente de las pruebas contra la base central de pruebas (la misma que usa el código bajo prueba). */
export const controlTestDb = new PrismaClient({
  adapter: new PrismaPg({ connectionString: controlTestUrl() }),
});

/** Vacía todas las tablas de la base central de pruebas (el trigger de solo inserción no impide TRUNCATE). */
export async function resetControlDatabase(): Promise<void> {
  const rows = await controlTestDb.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (rows.length === 0) {
    return;
  }
  const tables = rows.map((row) => `"${row.tablename}"`).join(", ");
  await controlTestDb.$executeRawUnsafe(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
}

export async function closeControlTestDatabase(): Promise<void> {
  await controlTestDb.$disconnect();
}
