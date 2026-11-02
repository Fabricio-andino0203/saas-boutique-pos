import "dotenv/config";

import { db } from "../../src/lib/db";
import { tenantRefFromRecord, type TenantRecord } from "../../src/lib/tenancy/control-directory";
import { closeControlDb, controlDb } from "../../src/lib/tenancy/control-db";
import {
  closeAllTenantClients,
  configureTenantPool,
  tenantPoolStats,
} from "../../src/lib/tenancy/tenant-clients";
import { runWithTenant } from "../../src/lib/tenancy/tenant-context";
import { serverEndpoint } from "../../src/lib/tenancy/tenant-url";
import { getVault } from "../../src/lib/tenancy/vault";
import { finishScript, flagValue, reportScriptError } from "../lib/tenant-run";
import { assertDisposableServer, Latencies, numberFlag, printTable, SLUG_PREFIX } from "./common";

/**
 * Cuánto cuesta tener un negocio «abierto» en la aplicación: tiempo de abrirlo, memoria y conexiones. Abre negocios uno tras
 * otro (sin cerrar ninguno) y mide, con el recolector de basura forzado, cuánta memoria suma cada tramo.
 *
 *   CAPACITY_CONFIRM=<base central> node --expose-gc --import tsx scripts/capacity/pool.ts [--steps 1,10,25,50,100] [--pool-size 3]
 */

const MB = 1024 * 1024;

function settledRssMb(): number {
  const collect = (globalThis as { gc?: () => void }).gc;
  collect?.();
  collect?.();
  return Math.round(process.memoryUsage().rss / MB);
}

async function main(): Promise<void> {
  assertDisposableServer();
  const steps = (flagValue("steps") ?? "1,10,25,50,100").split(",").map(Number);
  const total = Math.max(...steps);
  configureTenantPool({
    maxActive: total + 10,
    poolSize: numberFlag("pool-size", 3),
    idleMs: 3_600_000,
  });

  const vault = getVault();
  const records: TenantRecord[] = await controlDb.tenant.findMany({
    where: { status: "ACTIVE", slug: { startsWith: SLUG_PREFIX } },
    orderBy: { slug: "asc" },
    take: total,
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

  const base = settledRssMb();
  const rows: (string | number)[][] = [
    ["negocios abiertos", "memoria MB", "MB por negocio", "abrir + 1.ª consulta ms (media)"],
  ];
  let opened = 0;
  let lastRss = base;
  let lastCount = 0;
  const times = new Latencies();
  for (const record of records) {
    const ref = tenantRefFromRecord(record, { vault, endpointFor: serverEndpoint });
    const at = performance.now();
    await runWithTenant(ref, () => db.user.count());
    times.add(performance.now() - at);
    opened += 1;
    if (steps.includes(opened)) {
      const rss = settledRssMb();
      rows.push([
        opened,
        rss,
        ((rss - lastRss) / (opened - lastCount)).toFixed(1),
        times.summary().mean,
      ]);
      lastRss = rss;
      lastCount = opened;
    }
  }
  printTable(`Memoria con cada negocio abierto (base del proceso: ${base} MB)`, rows);
  const stats = tenantPoolStats();
  console.log(
    `\nAbiertos ahora: ${stats.active} · conexiones por negocio (tope): ${stats.poolSize}`,
  );
  await closeAllTenantClients();
}

main()
  .catch(reportScriptError)
  .finally(async () => {
    await finishScript();
    await closeControlDb();
  });
