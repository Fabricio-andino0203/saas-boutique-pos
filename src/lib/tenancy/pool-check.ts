import { logger } from "@/lib/logger";
import { controlDb } from "@/lib/tenancy/control-db";
import { tenantPoolStats } from "@/lib/tenancy/tenant-clients";

/**
 * Al arrancar, compara el presupuesto de conexiones de esta instancia con lo que admite el servidor de Postgres y avisa en el
 * registro si no cabe. Es el error de configuración que más daño hace con muchos negocios: si la suma de los presupuestos pasa de
 * `max_connections`, el servidor se queda sin conexiones y TODOS los negocios fallan (docs/RUNBOOK.md §17).
 */

/** Conexiones que deben quedar libres para la base central, los respaldos en paralelo y el mantenimiento. */
export const BUDGET_MARGIN = 20;

export type BudgetVerdict = "ok" | "over";

/** El presupuesto cabe si, sumado al margen y a las conexiones reservadas del servidor, no pasa del máximo. */
export function judgeBudget(budget: number, serverMax: number, reserved: number): BudgetVerdict {
  return budget + BUDGET_MARGIN + reserved <= serverMax ? "ok" : "over";
}

/** Nunca lanza: una revisión que falla no debe impedir que la aplicación arranque. */
export async function checkConnectionBudget(): Promise<void> {
  if (process.env.TENANCY_MODE !== "multi") {
    return;
  }
  const stats = tenantPoolStats();
  if (process.env.TENANT_DB_HOST) {
    // Los negocios se atienden por otro servidor (p. ej. PgBouncer): lo que dice la base central no aplica.
    logger.info("pool.budget", { budget: stats.maxConnections, capacity: stats.capacity });
    return;
  }
  try {
    const [row] = await controlDb.$queryRaw<{ max: number; reserved: number }[]>`
      SELECT current_setting('max_connections')::int AS max,
             current_setting('superuser_reserved_connections')::int AS reserved
    `;
    if (!row) {
      return;
    }
    const verdict = judgeBudget(stats.maxConnections, row.max, row.reserved);
    const fields = {
      budget: stats.maxConnections,
      capacity: stats.capacity,
      serverMax: row.max,
      reserved: row.reserved,
    };
    if (verdict === "over") {
      logger.warn("pool.budget_exceeds_server", {
        ...fields,
        hint: `Baja TENANT_POOL_MAX_CONNECTIONS a ${Math.max(2, row.max - row.reserved - BUDGET_MARGIN)} o menos, o sube POSTGRES_MAX_CONNECTIONS. Con varias instancias, la suma de sus presupuestos debe caber.`,
      });
    } else {
      logger.info("pool.budget", fields);
    }
  } catch (error) {
    logger.warn("pool.budget_check_failed", { error });
  }
}
