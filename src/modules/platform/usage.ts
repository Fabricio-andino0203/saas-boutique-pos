import type { Prisma } from "@/generated/control/client";
import { parseLimits } from "@/lib/tenancy/billing";
import { controlDb, type ControlDb } from "@/lib/tenancy/control-db";
import { withClient } from "@/lib/tenancy/provision-db";
import { adminUrlFor, readSchemaVersion } from "@/lib/tenancy/provision-steps";
import { BACKED_UP_STATUSES } from "@/modules/platform/backups";
import { provisioningConfig, type ProvisioningDeps } from "@/modules/platform/provisioning";

/**
 * Uso de cada negocio (propuesta SaaS §6 y §7): cuántos usuarios, productos y ventas tiene, cuándo fue su última venta y su
 * último ingreso, y cuánto pesa su base.
 *
 * **Lista blanca.** El panel ve *cuánto* usa un negocio, nunca *qué*: cada medida es una cuenta o una fecha, calculada con una
 * consulta fija de este archivo, y se guarda en columnas numéricas que no pueden contener un nombre, un cliente ni un monto.
 * Agregar una medida exige tocar esta lista, la tabla y su prueba: ahí se revisa que siga siendo solo un número.
 */

/** Las medidas permitidas, en el orden en que se guardan. Una prueba exige que la tabla tenga exactamente estas columnas. */
export const USAGE_METRICS = [
  "activeUsers",
  "products",
  "sales30d",
  "lastSaleAt",
  "lastLoginAt",
  "databaseMb",
  "schemaVersion",
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const SALES_WINDOW_DAYS = 30;
/** Cuánto historial de fotos se conserva. */
const KEEP_SNAPSHOTS_DAYS = 400;

export type UsageReading = {
  activeUsers: number;
  products: number;
  sales30d: number;
  lastSaleAt: Date | null;
  lastLoginAt: Date | null;
  databaseMb: number;
  schemaVersion: string | null;
};

/**
 * Lee las medidas de una base de negocio con la cuenta de aprovisionamiento. La consulta es una sola, fija y de solo lectura:
 * cuentas, fechas máximas y el tamaño de la base. No lee ninguna columna con datos del negocio.
 */
export async function readUsage(
  databaseUrl: string,
  now: Date = new Date(),
): Promise<UsageReading> {
  const since = new Date(now.getTime() - SALES_WINDOW_DAYS * DAY_MS);
  const [reading, schemaVersion] = await Promise.all([
    withClient(databaseUrl, async (client) => {
      const rows = await client.$queryRaw<
        {
          activeUsers: number;
          products: number;
          sales30d: number;
          lastSaleAt: Date | null;
          lastLoginAt: Date | null;
          databaseMb: number;
        }[]
      >`
        SELECT
          (SELECT count(*)::int FROM "User" WHERE "isActive") AS "activeUsers",
          (SELECT count(*)::int FROM "Product" WHERE "archivedAt" IS NULL) AS "products",
          (SELECT count(*)::int FROM "Sale" WHERE "status" = 'COMPLETED' AND "createdAt" >= ${since}) AS "sales30d",
          (SELECT max("createdAt") FROM "Sale" WHERE "status" = 'COMPLETED') AS "lastSaleAt",
          (SELECT max("lastLoginAt") FROM "User") AS "lastLoginAt",
          (pg_database_size(current_database()) / 1048576)::int AS "databaseMb"
      `;
      const row = rows[0];
      if (!row) {
        throw new Error("La consulta de uso no devolvió nada");
      }
      return row;
    }),
    readSchemaVersion(databaseUrl).catch(() => null),
  ]);
  return { ...reading, schemaVersion };
}

export type UsageDeps = Pick<ProvisioningDeps, "client" | "config" | "now"> & {
  /** Para pruebas: cómo se lee una base. */
  read?: (databaseUrl: string, now: Date) => Promise<UsageReading>;
};

export type UsageReport = {
  collected: string[];
  failed: { slug: string; error: string }[];
};

async function runPool<T>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, queue.length)) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
        await work(item);
      }
    }),
  );
}

/**
 * Toma una foto del uso de los negocios que tienen base en el servidor (o solo de `only`). Un negocio que no responde se anota
 * como fallido y no impide los demás. También retira las fotos de hace más de 400 días.
 */
export async function collectUsage(
  options: { only?: string[]; concurrency?: number } = {},
  deps: UsageDeps = {},
): Promise<UsageReport> {
  const client: ControlDb = deps.client ?? controlDb;
  const { adminUrl } = provisioningConfig(deps.config);
  const now = (deps.now ?? (() => new Date()))();
  const read = deps.read ?? readUsage;

  const tenants = await client.tenant.findMany({
    where: {
      status: { in: BACKED_UP_STATUSES },
      dbName: { not: null },
      ...(options.only ? { slug: { in: options.only } } : {}),
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, slug: true, dbName: true },
  });

  const report: UsageReport = { collected: [], failed: [] };
  await runPool(tenants, options.concurrency ?? 4, async (tenant) => {
    try {
      const reading = await read(adminUrlFor(adminUrl, tenant.dbName as string), now);
      await client.tenantUsageSnapshot.create({
        data: { tenantId: tenant.id, takenAt: now, ...reading },
      });
      report.collected.push(tenant.slug);
    } catch (error) {
      report.failed.push({
        slug: tenant.slug,
        error: error instanceof Error ? error.message.split("\n")[0]! : String(error),
      });
    }
  });

  await client.tenantUsageSnapshot.deleteMany({
    where: { takenAt: { lt: new Date(now.getTime() - KEEP_SNAPSHOTS_DAYS * DAY_MS) } },
  });
  report.collected.sort();
  return report;
}

export type TenantUsage = {
  takenAt: Date;
  reading: UsageReading;
  limits: { users: number | null; products: number | null };
};

/** La última foto de un negocio con los límites de su plan (para ver cuánto le falta para el tope). */
export async function getTenantUsage(
  tenantId: string,
  deps: Pick<UsageDeps, "client"> = {},
): Promise<TenantUsage | null> {
  const client: ControlDb = deps.client ?? controlDb;
  const [snapshot, subscription] = await Promise.all([
    client.tenantUsageSnapshot.findFirst({
      where: { tenantId },
      orderBy: { takenAt: "desc" },
    }),
    client.subscription.findFirst({
      where: { tenantId, status: { not: "EXPIRED" } },
      select: { plan: { select: { limits: true } } },
    }),
  ]);
  if (!snapshot) {
    return null;
  }
  const limits = subscription ? parseLimits(subscription.plan.limits as Prisma.JsonValue) : null;
  return {
    takenAt: snapshot.takenAt,
    reading: {
      activeUsers: snapshot.activeUsers,
      products: snapshot.products,
      sales30d: snapshot.sales30d,
      lastSaleAt: snapshot.lastSaleAt,
      lastLoginAt: snapshot.lastLoginAt,
      databaseMb: snapshot.databaseMb,
      schemaVersion: snapshot.schemaVersion,
    },
    limits: { users: limits?.users ?? null, products: limits?.products ?? null },
  };
}

/** `true` si el uso llegó al 90 % o más del tope (un aviso de que conviene ofrecer un plan mayor). */
export function nearLimit(used: number, limit: number | null): boolean {
  return limit !== null && limit > 0 && used / limit >= 0.9;
}
