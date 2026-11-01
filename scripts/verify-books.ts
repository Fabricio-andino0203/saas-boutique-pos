import "dotenv/config";

import {
  finishScript,
  flagValue,
  isMultiTenant,
  reportScriptError,
  runForTenant,
} from "./lib/tenant-run";

/**
 * Verifica que los libros de una base cuadran (inventario, ventas, devoluciones, crédito, caja y correlativos) y que
 * alguien puede entrar. Es el paso final de una restauración: `pnpm db:verify`. Sale con código 1 si algo no cuadra.
 *
 * Para revisar una base restaurada junto a la real: VERIFY_DATABASE=boutique_pos_restore pnpm db:verify
 * (usa el mismo servidor y credenciales de DATABASE_URL, con otro nombre de base).
 * Con varios negocios (TENANCY_MODE=multi): `--tenant <subdominio>` verifica la base de ese negocio.
 */
async function main(): Promise<void> {
  const target = process.env.VERIFY_DATABASE;
  let restoreUrl: string | undefined;
  if (target) {
    const url = new URL(process.env.DATABASE_URL ?? "");
    url.pathname = `/${target}`;
    restoreUrl = url.toString();
    // En modo `single` la URL se fija antes de importar `db`, que la lee al cargarse.
    process.env.DATABASE_URL = restoreUrl;
  }
  const { db } = await import("../src/lib/db");
  const { verifyBooks } = await import("../src/modules/ops/verify-books");
  const { runWithTenant } = await import("../src/lib/tenancy/tenant-context");

  // Una base restaurada no es un negocio registrado: en modo `multi` se verifica como un negocio provisional.
  const inScope = <T>(fn: () => Promise<T>): Promise<T> =>
    restoreUrl && isMultiTenant()
      ? runWithTenant({ id: "verify", databaseUrl: restoreUrl }, fn)
      : runForTenant(fn);

  const report = await inScope(() => verifyBooks(db));
  const s = report.summary;
  const scope = isMultiTenant()
    ? `negocio ${flagValue("tenant") ?? process.env.TENANT}`
    : "la configurada en DATABASE_URL";
  console.log(`Base: ${target ?? scope}`);
  console.log(
    `Usuarios ${s.users} · productos ${s.products} · clientes ${s.customers} · ventas ${s.sales} · devoluciones ${s.returns} · turnos ${s.cashSessions} · auditoría ${s.auditLogs}`,
  );
  console.log(
    `Última venta: ${s.lastSaleNumber ?? "ninguna"}${s.lastSaleAt ? ` (${s.lastSaleAt.toISOString()})` : ""}`,
  );
  if (report.ok) {
    console.log("Libros cuadrados: todas las comprobaciones pasaron.");
    return;
  }
  console.error(`Hay ${report.problems.length} problema(s):`);
  for (const problem of report.problems) {
    console.error(` - [${problem.check}] ${problem.detail}`);
  }
  process.exitCode = 1;
}

main()
  .catch(reportScriptError)
  .finally(() => finishScript());
