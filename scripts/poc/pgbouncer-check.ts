import "dotenv/config";

import { readFileSync, writeFileSync } from "node:fs";

import { db } from "../../src/lib/db";
import { closeAllTenantClients } from "../../src/lib/tenancy/tenant-clients";
import { runWithTenant } from "../../src/lib/tenancy/tenant-context";
import {
  createTemplateDatabase,
  createTenantDatabase,
  dropDatabase,
  dropTenantDatabase,
} from "../../src/lib/tenancy/provision-db";
import { openCashSession } from "../../src/modules/cash/service";
import { recordMovement } from "../../src/modules/inventory/service";
import { verifyBooks } from "../../src/modules/ops/verify-books";
import { completeSale } from "../../src/modules/sales/service";

/**
 * Prueba de concepto (Etapa 0): ¿el motor de ventas real funciona detrás de PgBouncer en modo transacción?
 *
 *   prepare <archivo>        crea un negocio de prueba con datos y escribe sus credenciales en <archivo>
 *   check <archivo> <puerto> corre 50 cobros simultáneos directo a Postgres y luego a través de PgBouncer (<puerto>)
 *   cleanup                  borra lo creado
 *
 * Variables: DATABASE_URL = cuenta de aprovisionamiento. TENANCY_MODE se fija a `multi` aquí dentro.
 */
process.env.TENANCY_MODE = "multi";

const TEMPLATE = "poc_pgb_template";
const ID = "pgb";

type Saved = {
  adminUrl: string;
  role: string;
  password: string;
  database: string;
  variantId: string;
};

async function prepare(file: string): Promise<void> {
  const adminUrl = process.env.DATABASE_URL as string;
  await createTemplateDatabase(adminUrl, TEMPLATE);
  await dropTenantDatabase(adminUrl, ID);
  const provisioned = await createTenantDatabase(adminUrl, { id: ID, template: TEMPLATE });
  const tenant = { id: ID, databaseUrl: provisioned.appUrl };
  const variantId = await runWithTenant(tenant, async () => {
    const owner = await db.user.create({
      data: { id: "owner-pgb", name: "Dueño", username: "dueno", passwordHash: "x", role: "OWNER" },
    });
    const location = await db.location.create({
      data: { code: "MAIN", name: "Tienda", isDefault: true },
    });
    await db.terminal.create({ data: { name: "Caja 1", locationId: location.id } });
    const category = await db.category.create({ data: { name: "Mujer", slug: "mujer" } });
    const product = await db.product.create({
      data: { code: "P-1", name: "Vestido", categoryId: category.id, basePriceCents: 10_000 },
    });
    const variant = await db.variant.create({
      data: { productId: product.id, sku: "P-1-M", barcode: "BC-1", avgCostCents: 4_000 },
    });
    await db.$transaction((tx) =>
      recordMovement(tx, {
        variantId: variant.id,
        locationId: location.id,
        userId: owner.id,
        type: "INITIAL",
        quantity: 1_000,
      }),
    );
    await openCashSession({ id: owner.id, role: "OWNER" }, { openingFloatCents: 10_000 });
    return variant.id;
  });
  await closeAllTenantClients();
  const saved: Saved = {
    adminUrl,
    role: provisioned.role,
    password: provisioned.password,
    database: provisioned.database,
    variantId,
  };
  writeFileSync(file, JSON.stringify(saved), "utf8");
  console.log(`Negocio ${provisioned.database} listo (rol ${provisioned.role})`);
}

async function burst(
  label: string,
  databaseUrl: string,
  variantId: string,
  round: number,
): Promise<number> {
  const tenant = { id: `${ID}-${label}`, databaseUrl };
  const owner = { id: "owner-pgb", role: "OWNER" as const };
  const started = performance.now();
  const calls = await runWithTenant(tenant, () =>
    Promise.allSettled(
      Array.from({ length: 50 }, (_, index) =>
        completeSale(owner, {
          // 40 ventas distintas y 10 envíos de 5 ventas más (cada una se manda dos veces: una crea, la otra repite)
          clientRequestId: `pgb-${label}-${round}-${index < 40 ? `venta-${index}` : `repetida-${index % 5}`}`,
          lines: [{ variantId, quantity: 1 }],
          payments: [{ method: "CASH", amountCents: 10_000 }],
        }),
      ),
    ),
  );
  const elapsed = Math.round(performance.now() - started);
  const failed = calls.filter((call) => call.status === "rejected");
  const created = calls.filter(
    (call) => call.status === "fulfilled" && !call.value.replayed,
  ).length;
  console.log(
    `[${label}] 50 cobros en ${elapsed} ms · creadas ${created} (esperado 45) · rechazos ${failed.length}` +
      (failed[0]
        ? ` · primer error: ${String((failed[0] as PromiseRejectedResult).reason).slice(0, 160)}`
        : ""),
  );
  return created;
}

async function check(file: string, port: string): Promise<void> {
  const saved = JSON.parse(readFileSync(file, "utf8")) as Saved;
  const direct = new URL(saved.adminUrl);
  direct.pathname = `/${saved.database}`;
  direct.username = saved.role;
  direct.password = saved.password;
  const pooled = new URL(direct.toString());
  pooled.port = port;

  const createdDirect = await burst("directo", direct.toString(), saved.variantId, 1);
  const createdPooled = await burst("pgbouncer", pooled.toString(), saved.variantId, 2);

  const tenant = { id: `${ID}-verify`, databaseUrl: direct.toString() };
  const report = await runWithTenant(tenant, () => verifyBooks(db));
  const sales = await runWithTenant(tenant, () => db.sale.count());
  const stock = await runWithTenant(tenant, () => db.stockLevel.findFirstOrThrow());
  console.log(
    `Libros: ${report.ok ? "cuadrados" : `PROBLEMAS ${JSON.stringify(report.problems.slice(0, 3))}`} · ventas ${sales} (esperado 90) · existencia ${stock.onHand} (esperado 910)`,
  );
  if (
    !report.ok ||
    createdDirect !== 45 ||
    createdPooled !== 45 ||
    sales !== 90 ||
    stock.onHand !== 910
  ) {
    process.exitCode = 1;
  }
  await closeAllTenantClients();
}

async function cleanup(): Promise<void> {
  const adminUrl = process.env.DATABASE_URL as string;
  await closeAllTenantClients();
  await dropTenantDatabase(adminUrl, ID);
  await dropDatabase(adminUrl, TEMPLATE);
  console.log("Limpio");
}

const [command, a, b] = process.argv.slice(2);
const run =
  command === "prepare" && a
    ? prepare(a)
    : command === "check" && a && b
      ? check(a, b)
      : command === "cleanup"
        ? cleanup()
        : Promise.reject(new Error("Uso: prepare <archivo> | check <archivo> <puerto> | cleanup"));
run
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
