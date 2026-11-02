import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../src/generated/prisma/client";
import { tenantRefFromRecord, type TenantRecord } from "../../src/lib/tenancy/control-directory";
import { closeControlDb, controlDb } from "../../src/lib/tenancy/control-db";
import { serverEndpoint } from "../../src/lib/tenancy/tenant-url";
import { getVault } from "../../src/lib/tenancy/vault";
import { finishScript, reportScriptError } from "../lib/tenant-run";
import { assertDisposableServer, numberFlag, printTable, SLUG_PREFIX } from "./common";

/**
 * Cuánto cuesta, en tiempo y en CPU del proceso, cada paso de atender a un negocio: crear su cliente, abrirle una conexión nueva
 * y hacerle una consulta cuando todo ya está abierto. Dice dónde conviene gastar (y dónde ahorrar) en el administrador de
 * conexiones.
 *
 *   CAPACITY_CONFIRM=<base central> pnpm exec tsx scripts/capacity/client-cost.ts [--samples 30]
 */

type Cost = { wall: number; cpu: number };

async function measure<T>(run: () => Promise<T> | T): Promise<{ value: T; cost: Cost }> {
  const cpuBefore = process.cpuUsage();
  const started = performance.now();
  const value = await run();
  const wall = performance.now() - started;
  const cpu = process.cpuUsage(cpuBefore);
  return { value, cost: { wall, cpu: (cpu.user + cpu.system) / 1000 } };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round((sorted[Math.floor(sorted.length / 2)] ?? 0) * 10) / 10;
}

async function main(): Promise<void> {
  assertDisposableServer();
  const samples = numberFlag("samples", 30);
  const vault = getVault();
  const records: TenantRecord[] = await controlDb.tenant.findMany({
    where: { status: "ACTIVE", slug: { startsWith: SLUG_PREFIX } },
    orderBy: { slug: "asc" },
    take: samples,
    select: {
      id: true,
      slug: true,
      name: true,
      status: true,
      dbServerId: true,
      dbName: true,
      dbRole: true,
      dbCredentialEnc: true,
    },
  });

  const steps: Record<string, Cost[]> = {
    "crear el cliente (sin conectar)": [],
    "primera consulta (abre la conexión)": [],
    "segunda consulta (todo abierto)": [],
    "cerrar la conexión": [],
    "consulta con conexión nueva (el cliente ya existía)": [],
  };
  const keep: PrismaClient[] = [];
  for (const [index, record] of records.entries()) {
    const ref = tenantRefFromRecord(record, { vault, endpointFor: serverEndpoint });
    const created = await measure(
      () =>
        new PrismaClient({ adapter: new PrismaPg({ connectionString: ref.databaseUrl, max: 2 }) }),
    );
    const client = created.value;
    keep.push(client);
    const first = await measure(() => client.user.count());
    const second = await measure(() => client.user.count());
    const closed = await measure(() => client.$disconnect());
    const reopened = await measure(() => client.user.count());
    if (index >= 3) {
      // Las primeras vueltas calientan el código; no cuentan.
      steps["crear el cliente (sin conectar)"]?.push(created.cost);
      steps["primera consulta (abre la conexión)"]?.push(first.cost);
      steps["segunda consulta (todo abierto)"]?.push(second.cost);
      steps["cerrar la conexión"]?.push(closed.cost);
      steps["consulta con conexión nueva (el cliente ya existía)"]?.push(reopened.cost);
    }
  }
  printTable("Costo de cada paso (mediana)", [
    ["paso", "tiempo ms", "CPU ms"],
    ...Object.entries(steps).map(([name, costs]) => [
      name,
      median(costs.map((cost) => cost.wall)),
      median(costs.map((cost) => cost.cpu)),
    ]),
  ]);
  await Promise.all(keep.map((client) => client.$disconnect().catch(() => undefined)));
}

main()
  .catch(reportScriptError)
  .finally(async () => {
    await finishScript();
    await closeControlDb();
  });
