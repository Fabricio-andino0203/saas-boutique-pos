import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { env } from "@/lib/env";

/**
 * Cliente único de Prisma. Solo los `service` y `queries` de cada módulo deben importarlo;
 * las páginas y componentes nunca llaman a la BD directamente.
 */
function createClient() {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

const globalForDb = globalThis as unknown as { db?: ReturnType<typeof createClient> };

export const db = globalForDb.db ?? createClient();

if (env.NODE_ENV !== "production") {
  globalForDb.db = db;
}
