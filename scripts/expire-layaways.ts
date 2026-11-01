import "dotenv/config";

import { db } from "../src/lib/db";
import { expireAllOverdueLayaways } from "../src/modules/layaways/service";
import {
  finishScript,
  flagValue,
  hasFlag,
  isMultiTenant,
  reportScriptError,
  runForEachTenant,
  runForTenant,
} from "./lib/tenant-run";

/**
 * Tarea diaria para el cron del servidor: vence los apartados cuyo plazo ya pasó, libera sus prendas y manda lo abonado
 * a crédito de tienda. Es segura de repetir: si no hay nada vencido, no hace nada.
 *
 * Con varios negocios (TENANCY_MODE=multi): `--all` recorre todos los activos (lo normal para el cron) y `--tenant <subdominio>`
 * atiende solo uno. En una sola tienda no hace falta nada.
 */
async function expireOne(label: string): Promise<void> {
  const expired = await expireAllOverdueLayaways(db);
  // Con varios negocios cada línea dice de cuál es; con una sola tienda el mensaje es el de siempre.
  console.log(`${isMultiTenant() ? `[${label}] ` : ""}Apartados vencidos: ${expired}.`);
}

async function main(): Promise<void> {
  if (hasFlag("all") && !flagValue("tenant")) {
    const { failed } = await runForEachTenant(expireOne);
    if (failed > 0) {
      process.exitCode = 1;
    }
    return;
  }
  await runForTenant(() => expireOne(flagValue("tenant") ?? process.env.TENANT ?? "tienda"));
}

main()
  .catch(reportScriptError)
  .finally(() => finishScript());
