import "dotenv/config";

import { platformMessages } from "../src/config/messages.platform.es";
import { AppError } from "../src/lib/errors";
import { closeControlDb } from "../src/lib/tenancy/control-db";
import { describeAlert } from "../src/modules/platform/alert-text";
import { collectAlerts, needsAction } from "../src/modules/platform/alerts";
import { hasFlag, UsageError } from "./lib/tenant-run";

/**
 * Las alertas de la plataforma, desde el servidor: lo mismo que el Resumen del panel. Sale con código 1 si hay algo grave o
 * que conviene revisar (las de tipo «info» no hacen fallar el comando), así que sirve para un `cron` que avise por correo:
 *
 *   pnpm alerts:check [--json]      Lista las alertas. Con --json, una línea de JSON por alerta (para otro programa).
 */

const copy = platformMessages.alerts;
const LABEL = { critical: "GRAVE ", warning: "AVISO ", info: "info  " } as const;

async function main(): Promise<void> {
  const [command] = process.argv.slice(2);
  if (command !== "check") {
    throw new UsageError("Uso: pnpm alerts:check [--json]");
  }
  const alerts = await collectAlerts();
  if (hasFlag("json")) {
    for (const alert of alerts) {
      console.log(JSON.stringify(alert));
    }
  } else if (alerts.length === 0) {
    console.log(copy.none);
  } else {
    for (const alert of alerts) {
      console.log(`${LABEL[alert.severity]} ${describeAlert(alert).text}`);
    }
  }
  if (needsAction(alerts)) {
    process.exitCode = 1;
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
