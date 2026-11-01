import "dotenv/config";

import { formatLocalDateTime } from "../src/lib/dates";
import { AppError } from "../src/lib/errors";
import { closeControlDb, controlDb } from "../src/lib/tenancy/control-db";
import { collectUsage, getTenantUsage } from "../src/modules/platform/usage";
import { flagValue, UsageError } from "./lib/tenant-run";

/**
 * Uso de los negocios, desde el servidor. Solo números de una lista blanca: cuántos usuarios y productos, ventas de los últimos
 * 30 días, última venta y último ingreso, y el peso de la base. Nunca qué se vendió ni a quién.
 *
 *   pnpm usage:collect [--only a,b]      Toma una foto del uso de los negocios. Se corre una vez al día (ver docs/RUNBOOK.md §16).
 *   pnpm usage:show <subdominio>         Muestra la última foto de un negocio contra los límites de su plan.
 */

async function main(): Promise<void> {
  const [command, argument] = process.argv.slice(2);

  switch (command) {
    case "collect": {
      const only = flagValue("only")
        ?.split(",")
        .map((slug) => slug.trim())
        .filter(Boolean);
      const report = await collectUsage(only ? { only } : {});
      console.log(
        `Fotos tomadas: ${report.collected.length}${report.collected.length ? ` (${report.collected.join(", ")})` : ""}.`,
      );
      for (const item of report.failed) {
        console.error(`  ${item.slug}: no se pudo leer — ${item.error}`);
      }
      if (report.failed.length > 0) {
        process.exitCode = 1;
      }
      return;
    }
    case "show": {
      if (!argument || argument.startsWith("--")) {
        throw new UsageError("Uso: pnpm usage:show <subdominio>");
      }
      const tenant = await controlDb.tenant.findUnique({
        where: { slug: argument },
        select: { id: true },
      });
      if (!tenant) {
        throw new UsageError(`No existe el negocio "${argument}".`);
      }
      const usage = await getTenantUsage(tenant.id);
      if (!usage) {
        console.log("Todavía no hay fotos de uso: corre «pnpm usage:collect».");
        return;
      }
      const { reading, limits } = usage;
      const of = (used: number, limit: number | null) =>
        limit === null ? `${used}` : `${used} de ${limit}`;
      console.log(`Foto del ${formatLocalDateTime(usage.takenAt)}`);
      console.log(`  Usuarios activos : ${of(reading.activeUsers, limits.users)}`);
      console.log(`  Productos        : ${of(reading.products, limits.products)}`);
      console.log(`  Ventas (30 días) : ${reading.sales30d}`);
      console.log(
        `  Última venta     : ${reading.lastSaleAt ? formatLocalDateTime(reading.lastSaleAt) : "—"}`,
      );
      console.log(
        `  Último ingreso   : ${reading.lastLoginAt ? formatLocalDateTime(reading.lastLoginAt) : "—"}`,
      );
      console.log(`  Peso de la base  : ${reading.databaseMb} MB`);
      return;
    }
    default:
      throw new UsageError("Uso: pnpm usage:collect [--only a,b] | usage:show <subdominio>");
  }
}

main()
  .catch((error: unknown) => {
    if (error instanceof UsageError || error instanceof AppError) {
      console.error(error.message);
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  })
  .finally(() => closeControlDb());
