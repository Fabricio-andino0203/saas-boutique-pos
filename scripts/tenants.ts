import "dotenv/config";

import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";

import { AppError } from "../src/lib/errors";
import { closeControlDb } from "../src/lib/tenancy/control-db";
import { ensureTemplateCurrent } from "../src/lib/tenancy/provision-steps";
import { migrateFleet } from "../src/modules/platform/fleet";
import {
  archiveTenant,
  cancelTenantDeletion,
  DEFAULT_RETENTION_DAYS,
  requestTenantDeletion,
} from "../src/modules/platform/lifecycle";
import {
  provisioningConfig,
  resumeProvisioning,
  startProvisioning,
  undoProvisioning,
  type ProvisionOutcome,
} from "../src/modules/platform/provisioning";
import { reconcileTenants } from "../src/modules/platform/reconcile";
import { setTenantCanary } from "../src/modules/platform/tenants";
import { flagValue, hasFlag, UsageError } from "./lib/tenant-run";

/**
 * Altas, actualizaciones y bajas de los negocios, desde el servidor (lo mismo que el panel, para automatizar o cuando el
 * panel no está a mano). Todo queda en la auditoría de la plataforma como acción del sistema.
 *
 *   pnpm tenants:template [--force]                 Deja al día la base «dorada» desde la que se copia cada negocio nuevo.
 *   pnpm tenants:provision --slug <s> --name "<n>" --owner-name "<n>" --owner-username <u> [--owner-email <e>]
 *                                                   Da de alta un negocio (la contraseña temporal sale de OWNER_PASSWORD o se pregunta).
 *   pnpm tenants:resume <slug>                      Retoma un alta que falló o se interrumpió.
 *   pnpm tenants:undo <slug>                        Deshace un alta que no terminó (borra su base y su rol).
 *   pnpm tenants:migrate [--force] [--only a,b] [--concurrency N] [--no-canary-gate]
 *                                                   Lleva la base de cada negocio a la última versión (los canarios primero).
 *   pnpm tenants:canary <slug> on|off               Marca un negocio como canario: se migra primero y, si falla, detiene al resto.
 *   pnpm tenants:reconcile                          Compara lo registrado con lo que hay en el servidor.
 *   pnpm tenants:delete <slug> --reason "<motivo>"  Pide la baja: deja de atender y empieza la retención.
 *   pnpm tenants:cancel-delete <slug>               Cancela una baja pendiente.
 *   pnpm tenants:archive <slug> --confirm <slug> [--early]
 *                                                   Archiva (renombra la base, no la destruye) un negocio con la retención cumplida.
 */

function createMutableOutput(): { stream: Writable; muted: { value: boolean } } {
  const muted = { value: false };
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted.value) {
        process.stdout.write(chunk);
      }
      callback();
    },
  });
  return { stream, muted };
}

async function askPassword(): Promise<string> {
  const { stream, muted } = createMutableOutput();
  const rl = createInterface({
    input: process.stdin,
    output: stream,
    terminal: Boolean(process.stdin.isTTY),
  });
  const lines = rl[Symbol.asyncIterator]();
  try {
    process.stdout.write("Contraseña temporal del propietario (mínimo 8 caracteres): ");
    muted.value = true;
    const { value } = await lines.next();
    muted.value = false;
    process.stdout.write("\n");
    return String(value ?? "");
  } finally {
    rl.close();
  }
}

function required(name: string): string {
  const value = flagValue(name);
  if (!value) {
    throw new UsageError(`Falta --${name}. Mira el encabezado de scripts/tenants.ts para el uso.`);
  }
  return value;
}

function printOutcome(outcome: ProvisionOutcome): void {
  const base = process.env.TENANT_BASE_DOMAIN;
  if (outcome.status === "SUCCEEDED") {
    console.log(`Listo: el negocio "${outcome.slug}" quedó dado de alta.`);
    console.log(
      base
        ? `Dirección: ${outcome.slug}.${base} — el propietario entra con la contraseña temporal y debe cambiarla.`
        : "El propietario entra con la contraseña temporal y debe cambiarla.",
    );
    return;
  }
  console.error(
    `El alta de "${outcome.slug}" se detuvo en el paso «${outcome.step}»: ${outcome.error}`,
  );
  console.error(
    `Corrige la causa y retómala con «pnpm tenants:resume ${outcome.slug}», o deshazla con «pnpm tenants:undo ${outcome.slug}».`,
  );
  process.exitCode = 1;
}

async function main(): Promise<void> {
  const [command, argument] = process.argv.slice(2);
  const context = { actor: null };

  switch (command) {
    case "template": {
      const config = provisioningConfig();
      const { rebuilt } = await ensureTemplateCurrent(config.adminUrl, {
        name: config.templateDb,
        force: hasFlag("force"),
      });
      console.log(
        rebuilt
          ? `Plantilla «${config.templateDb}» rehecha y migrada.`
          : `Plantilla «${config.templateDb}» al día.`,
      );
      return;
    }
    case "provision": {
      const password = process.env.OWNER_PASSWORD ?? (await askPassword());
      printOutcome(
        await startProvisioning(
          {
            slug: required("slug"),
            name: required("name"),
            ownerName: required("owner-name"),
            ownerUsername: required("owner-username"),
            ownerEmail: flagValue("owner-email"),
            ownerPassword: password,
          },
          context,
        ),
      );
      return;
    }
    case "resume": {
      printOutcome(await resumeProvisioning(requireArgument(argument, "resume"), context));
      return;
    }
    case "undo": {
      await undoProvisioning(requireArgument(argument, "undo"), context);
      console.log(
        `Alta deshecha: la base y el rol de "${argument}" ya no existen. Puedes registrarlo de nuevo.`,
      );
      return;
    }
    case "migrate": {
      const only = flagValue("only")
        ?.split(",")
        .map((slug) => slug.trim())
        .filter(Boolean);
      const concurrency = flagValue("concurrency");
      const report = await migrateFleet(
        {
          force: hasFlag("force"),
          canaryGate: !hasFlag("no-canary-gate"),
          ...(only ? { only } : {}),
          ...(concurrency ? { concurrency: Number(concurrency) } : {}),
        },
        context,
      );
      for (const entry of report.entries) {
        const detail = entry.error ? ` — ${entry.error.split("\n")[0]}` : "";
        console.log(`${entry.slug.padEnd(24)} ${entry.result}${detail}`);
      }
      console.log(
        `Última versión: ${report.latest}. Migrados ${report.migrated}, al día ${report.skipped}, con error ${report.failed}, sin tocar ${report.blocked}.`,
      );
      if (report.failed + report.blocked > 0) {
        process.exitCode = 1;
      }
      return;
    }
    case "canary": {
      const slug = requireArgument(argument, "canary");
      const flag = process.argv[4];
      if (flag !== "on" && flag !== "off") {
        throw new UsageError("Uso: pnpm tenants:canary <subdominio> on|off");
      }
      await setTenantCanary({ slug, canary: flag === "on" }, context);
      console.log(
        flag === "on"
          ? `"${slug}" ahora es canario: se migra primero.`
          : `"${slug}" ya no es canario.`,
      );
      return;
    }
    case "reconcile": {
      const report = await reconcileTenants();
      const show = (title: string, lines: string[]) => {
        if (lines.length > 0) {
          console.log(`${title}:`);
          for (const line of lines) console.log(`  - ${line}`);
        }
      };
      show("Bases del servidor que ningún negocio reclama", report.orphanDatabases);
      show("Roles del servidor que ningún negocio reclama", report.orphanRoles);
      show(
        "Negocios cuya base no está en el servidor",
        report.missingDatabases.map((item) => `${item.slug} (${item.database})`),
      );
      show(
        "Negocios archivados cuya base archivada no está",
        report.missingArchives.map((item) => `${item.slug} (${item.database})`),
      );
      show(
        "Altas «en marcha» sin signos de vida (retómalas o deshazlas)",
        report.staleRuns.map((item) => item.slug),
      );
      show(
        "Negocios con datos atrasados (corre «pnpm tenants:migrate»)",
        report.behind.map((item) => `${item.slug}: ${item.schemaVersion ?? "sin versión"}`),
      );
      if (report.ok) {
        console.log("Todo cuadra: lo registrado es lo que hay en el servidor.");
      } else {
        process.exitCode = 1;
      }
      return;
    }
    case "delete": {
      const { deleteAfter } = await requestTenantDeletion(
        { slug: requireArgument(argument, "delete"), reason: required("reason") },
        context,
      );
      console.log(
        `Baja pedida: "${argument}" ya no atiende. Se puede cancelar hasta el ${deleteAfter.toISOString().slice(0, 10)} (${DEFAULT_RETENTION_DAYS} días); después se puede archivar.`,
      );
      return;
    }
    case "cancel-delete": {
      await cancelTenantDeletion(requireArgument(argument, "cancel-delete"), context);
      console.log(`Baja cancelada: "${argument}" volvió a como estaba.`);
      return;
    }
    case "archive": {
      const { archivedDatabase } = await archiveTenant(
        {
          slug: requireArgument(argument, "archive"),
          confirm: flagValue("confirm") ?? "",
          early: hasFlag("early"),
        },
        context,
      );
      console.log(
        `Archivado: la base de "${argument}" se conserva como «${archivedDatabase}» (no se destruyó). Su rol ya no existe.`,
      );
      return;
    }
    default:
      throw new UsageError(
        "Uso: pnpm tenants:template | provision | resume <s> | undo <s> | migrate | canary <s> on|off | reconcile | delete <s> | cancel-delete <s> | archive <s>",
      );
  }
}

function requireArgument(value: string | undefined, command: string): string {
  if (!value || value.startsWith("--")) {
    throw new UsageError(`Uso: pnpm tenants:${command} <subdominio>`);
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
