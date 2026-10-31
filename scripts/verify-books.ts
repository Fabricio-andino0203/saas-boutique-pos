import "dotenv/config";

/**
 * Verifica que los libros de una base cuadran (inventario, ventas, devoluciones, crédito, caja y correlativos) y que
 * alguien puede entrar. Es el paso final de una restauración: `pnpm db:verify`. Sale con código 1 si algo no cuadra.
 *
 * Para revisar una base restaurada junto a la real: VERIFY_DATABASE=boutique_pos_restore pnpm db:verify
 * (usa el mismo servidor y credenciales de DATABASE_URL, con otro nombre de base).
 */
async function main(): Promise<void> {
  const target = process.env.VERIFY_DATABASE;
  if (target) {
    const url = new URL(process.env.DATABASE_URL ?? "");
    url.pathname = `/${target}`;
    // Debe fijarse antes de importar `db`, que lee la URL al cargarse.
    process.env.DATABASE_URL = url.toString();
  }
  const { db } = await import("../src/lib/db");
  const { verifyBooks } = await import("../src/modules/ops/verify-books");

  try {
    const report = await verifyBooks(db);
    const s = report.summary;
    console.log(`Base: ${target ?? "la configurada en DATABASE_URL"}`);
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
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
