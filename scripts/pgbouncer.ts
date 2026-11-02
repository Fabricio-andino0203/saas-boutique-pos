import "dotenv/config";

import { ensurePgbouncerAuth, PGBOUNCER_USER } from "../src/lib/tenancy/pgbouncer";
import { reportScriptError, UsageError } from "./lib/tenant-run";

/**
 * Prepara Postgres para PgBouncer (ver docs/RUNBOOK.md §17). Se corre una vez al encenderlo, y de nuevo si cambias la contraseña.
 *
 *   PGBOUNCER_AUTH_PASSWORD=<contraseña> pnpm pgbouncer:setup
 *
 * Crea la cuenta `pgbouncer` (solo puede ejecutar la función que consulta contraseñas de los negocios) y esa función en la base
 * `postgres`. Usa la cuenta de aprovisionamiento (`TENANT_PROVISIONING_URL`).
 */
async function main(): Promise<void> {
  const [command] = process.argv.slice(2);
  if (command !== "setup") {
    throw new UsageError("Uso: PGBOUNCER_AUTH_PASSWORD=<contraseña> pnpm pgbouncer:setup");
  }
  const adminUrl = process.env.TENANT_PROVISIONING_URL;
  const password = process.env.PGBOUNCER_AUTH_PASSWORD;
  if (!adminUrl) {
    throw new UsageError("Falta TENANT_PROVISIONING_URL (la cuenta que puede crear roles).");
  }
  if (!password) {
    throw new UsageError("Falta PGBOUNCER_AUTH_PASSWORD (la contraseña de la cuenta de consulta).");
  }
  await ensurePgbouncerAuth(adminUrl, { password });
  console.log(
    `Listo: la cuenta «${PGBOUNCER_USER}» y su función quedaron al día. Pon la misma contraseña en PGB_AUTH_PASSWORD de PgBouncer.`,
  );
}

main().catch(reportScriptError);
