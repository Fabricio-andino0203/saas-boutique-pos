import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export async function checkDatabase(query: () => Promise<unknown>): Promise<boolean> {
  try {
    await query();
    return true;
  } catch {
    return false;
  }
}

export function createHealthHandler(check: () => Promise<boolean>) {
  return async (): Promise<Response> => {
    const healthy = await check();
    if (!healthy) {
      logger.error("health.unhealthy");
    }
    return Response.json({ status: healthy ? "ok" : "error" }, { status: healthy ? 200 : 503 });
  };
}

export function pingDatabase(): Promise<boolean> {
  return checkDatabase(() => db.$queryRaw`select 1`);
}

/** Una migración que empezó y no terminó (falló a la mitad) deja la base en un estado que nadie debe usar. */
export async function countUnfinishedMigrations(): Promise<number> {
  const rows = await db.$queryRaw<{ count: bigint }[]>`
    SELECT count(*) AS count FROM "_prisma_migrations"
    WHERE "finished_at" IS NULL AND "rolled_back_at" IS NULL
  `;
  return Number(rows[0]?.count ?? 0);
}

export function pingMigrations(): Promise<boolean> {
  return checkDatabase(async () => {
    if ((await countUnfinishedMigrations()) > 0) {
      throw new Error("Hay una migración sin terminar");
    }
  });
}

/** Lo que mira `/api/health`: la base responde y sus migraciones están completas. */
export async function checkHealth(): Promise<boolean> {
  return (await pingDatabase()) && (await pingMigrations());
}
