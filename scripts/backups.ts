import "dotenv/config";

import { formatLocalDateTime } from "../src/lib/dates";
import { AppError } from "../src/lib/errors";
import { closeControlDb } from "../src/lib/tenancy/control-db";
import {
  backupOverview,
  listTenantBackups,
  requestControlBackup,
  requestTenantBackup,
  type BackupState,
} from "../src/modules/platform/backups";
import { controlDb } from "../src/lib/tenancy/control-db";
import {
  dropRetiredDatabase,
  listRetiredDatabases,
  requestFinalDump,
} from "../src/modules/platform/retired";
import { flagValue, hasFlag, UsageError } from "./lib/tenant-run";

/**
 * Respaldos por negocio, desde el servidor (lo mismo que el panel). El respaldo en sí lo hace el servicio `backup` (otro
 * contenedor, que tiene la clave y los archivos); aquí se consulta su registro y se le piden respaldos.
 *
 *   pnpm backups:status                       Estado del respaldo de cada negocio y de la base central. Sale con error si alguno
 *                                             está atrasado, falló o nunca se hizo (para correrlo desde un cron que avise).
 *   pnpm backups:list <subdominio>            Los últimos respaldos de un negocio (también los fallidos y los ya retirados).
 *   pnpm backups:request <subdominio>         Pide un respaldo ahora; el servicio de respaldos lo toma en unos segundos.
 *   pnpm backups:request --control            Lo mismo para la base central de la plataforma.
 */

const context = { actor: null };

const STATE_LABEL: Record<BackupState, string> = {
  ok: "al día",
  stale: "ATRASADO",
  failed: "FALLÓ",
  never: "NUNCA",
  pending: "pendiente",
};

const when = (date: Date | null) => (date ? formatLocalDateTime(date) : "—");

async function main(): Promise<void> {
  const [command, argument] = process.argv.slice(2);

  switch (command) {
    case "status": {
      const overview = await backupOverview();
      console.log(
        `${"Negocio".padEnd(26)} ${"Estado".padEnd(10)} ${"Último bueno".padEnd(20)} Días`,
      );
      console.log(
        `${"(base central)".padEnd(26)} ${STATE_LABEL[overview.control.state].padEnd(10)} ${when(overview.control.lastOkAt).padEnd(20)}`,
      );
      for (const row of overview.tenants) {
        const days = `${row.retentionDays}${row.retentionFromPlan ? "" : " (servidor)"}`;
        console.log(
          `${row.slug.padEnd(26)} ${STATE_LABEL[row.state].padEnd(10)} ${when(row.lastOkAt).padEnd(20)} ${days}${row.open ? "  · hay uno pedido" : ""}`,
        );
      }
      if (overview.attention.length > 0) {
        console.error(`\n${overview.attention.length} con respaldo que revisar.`);
        process.exitCode = 1;
      }
      return;
    }
    case "list": {
      const slug = requireArgument(argument, "list");
      const tenant = await controlDb.tenant.findUnique({ where: { slug }, select: { id: true } });
      if (!tenant) {
        throw new UsageError(`No existe el negocio "${slug}".`);
      }
      for (const row of await listTenantBackups(tenant.id, {
        take: Number(flagValue("take") ?? 20),
      })) {
        const state = row.prunedAt ? "retirado" : row.status;
        console.log(
          `${when(row.requestedAt).padEnd(20)} ${state.padEnd(10)} ${row.trigger.padEnd(10)} ${row.fileName ?? "—"}${row.error ? `  — ${row.error}` : ""}`,
        );
      }
      return;
    }
    case "request": {
      if (hasFlag("control")) {
        await requestControlBackup(context);
        console.log(
          "Pedido el respaldo de la base central: el servicio de respaldos lo hace en unos segundos.",
        );
        return;
      }
      const slug = requireArgument(argument, "request");
      await requestTenantBackup(slug, context);
      console.log(
        `Pedido el respaldo de "${slug}": el servicio de respaldos lo hace en unos segundos.`,
      );
      return;
    }
    case "retired": {
      const rows = await listRetiredDatabases();
      if (rows.length === 0) {
        console.log("No hay bases apartadas.");
        return;
      }
      for (const row of rows) {
        const dump =
          row.finalDump.state === "ok"
            ? `volcado listo (${row.finalDump.fileName})`
            : `volcado: ${row.finalDump.state}`;
        console.log(
          `${row.database.padEnd(48)} ${row.kind.padEnd(9)} ${(row.slug ?? "—").padEnd(20)} ${dump}`,
        );
      }
      return;
    }
    case "final": {
      const database = requireArgument(argument, "final");
      await requestFinalDump(database, context);
      console.log(
        `Pedido el volcado final de "${database}": el servicio de respaldos lo hace en unos segundos.`,
      );
      return;
    }
    case "drop": {
      const database = requireArgument(argument, "drop");
      const { dumpFile } = await dropRetiredDatabase(
        { database, confirm: flagValue("confirm") ?? "" },
        context,
      );
      console.log(`Borrada: "${database}". Su volcado final se conserva: ${dumpFile}`);
      return;
    }
    default:
      throw new UsageError(
        "Uso: pnpm backups:status | list <s> | request <s>|--control | retired | final <base> | drop <base> --confirm <base>",
      );
  }
}

function requireArgument(value: string | undefined, command: string): string {
  if (!value || value.startsWith("--")) {
    throw new UsageError(
      command === "final" || command === "drop"
        ? `Uso: pnpm backups:${command} <base>`
        : `Uso: pnpm backups:${command} <subdominio>`,
    );
  }
  return value;
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
