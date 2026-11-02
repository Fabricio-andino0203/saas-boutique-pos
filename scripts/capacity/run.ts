import "dotenv/config";

import { writeFileSync } from "node:fs";

import { db } from "../../src/lib/db";
import { tenantRefFromRecord, type TenantRecord } from "../../src/lib/tenancy/control-directory";
import { closeControlDb, controlDb } from "../../src/lib/tenancy/control-db";
import {
  closeAllTenantClients,
  configureTenantPool,
  tenantPoolStats,
} from "../../src/lib/tenancy/tenant-clients";
import { runWithTenant, type TenantRef } from "../../src/lib/tenancy/tenant-context";
import { serverEndpoint } from "../../src/lib/tenancy/tenant-url";
import { getVault } from "../../src/lib/tenancy/vault";
import { login } from "../../src/modules/auth/service";
import { verifyBooks } from "../../src/modules/ops/verify-books";
import { reportAccess } from "../../src/modules/reports/access";
import { getDashboard } from "../../src/modules/reports/dashboard";
import { listSales } from "../../src/modules/sales/list-queries";
import { lookupCode, searchSellable } from "../../src/modules/sales/pos-queries";
import { completeSale } from "../../src/modules/sales/service";
import { finishScript, flagValue, hasFlag, reportScriptError } from "../lib/tenant-run";
import {
  assertDisposableServer,
  classifyError,
  Latencies,
  LOAD_PRODUCT_CODE,
  numberFlag,
  OWNER_PASSWORD,
  printTable,
  seededRandom,
  sleep,
  SLUG_PREFIX,
  watchProcess,
  watchServerConnections,
  weightedPick,
} from "./common";

/**
 * Carga de la flota «dentro del proceso»: muchos negocios a la vez usando el motor REAL (ventas, búsquedas, inicio del día,
 * listas, ingresos) a través del mismo administrador de conexiones que usa la aplicación. Al terminar comprueba, negocio por
 * negocio, que no se mezcló nada y que los libros cuadran.
 *
 *   CAPACITY_CONFIRM=<base central> pnpm capacity:run [--tenants 200] [--workers 40] [--seconds 60]
 *        [--hot 0.2 --hot-share 0.8 | --uniform] [--rate <operaciones por segundo>] [--max-connections 60] [--pool-size 2] [--max-active 100]
 *        [--mix sale:55,search:15,lookup:5,dashboard:12,list:10,login:3] [--warmup <segundos que no se cuentan>] [--flood <trabajadores extra contra UN negocio>] [--seed 1] [--out resultado.json]
 *
 * Con `TENANT_DB_HOST` / `TENANT_DB_PORT` en el entorno las conexiones de los negocios van a otro puerto (p. ej. PgBouncer).
 */

type Op = "sale" | "search" | "lookup" | "dashboard" | "list" | "login";

type TenantState = {
  index: number;
  slug: string;
  ref: TenantRef;
  ownerId: string;
  variants: { id: string; barcode: string | null }[];
  stockBefore: number;
  confirmed: number;
  uncertain: number;
  soldUnits: number;
  retried: number;
};

const DEFAULT_MIX = "sale:55,search:15,lookup:5,dashboard:12,list:10,login:3";

function parseMix(raw: string): [Op, number][] {
  return raw.split(",").map((part) => {
    const [name, weight] = part.split(":");
    return [name as Op, Number(weight)];
  });
}

async function loadTenants(limit: number): Promise<TenantState[]> {
  const vault = getVault();
  const records: TenantRecord[] = await controlDb.tenant.findMany({
    where: { status: "ACTIVE", slug: { startsWith: SLUG_PREFIX } },
    orderBy: { slug: "asc" },
    take: limit,
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
  const states: TenantState[] = [];
  for (const [index, record] of records.entries()) {
    const ref = tenantRefFromRecord(record, { vault, endpointFor: serverEndpoint });
    states.push({
      index,
      slug: record.slug,
      ref,
      ownerId: "",
      variants: [],
      stockBefore: 0,
      confirmed: 0,
      uncertain: 0,
      soldUnits: 0,
      retried: 0,
    });
  }
  return states;
}

async function prepare(tenant: TenantState): Promise<void> {
  await runWithTenant(tenant.ref, async () => {
    const owner = await db.user.findFirstOrThrow({
      where: { role: "OWNER" },
      select: { id: true },
    });
    const variants = await db.variant.findMany({
      where: { product: { code: LOAD_PRODUCT_CODE } },
      select: { id: true, barcode: true },
    });
    if (variants.length === 0) {
      throw new Error(`${tenant.slug}: faltan las prendas de carga (corre capacity:provision)`);
    }
    const stock = await db.stockLevel.aggregate({
      where: { variantId: { in: variants.map((variant) => variant.id) } },
      _sum: { onHand: true },
    });
    tenant.ownerId = owner.id;
    tenant.variants = variants;
    tenant.stockBefore = stock._sum.onHand ?? 0;
  });
}

async function inPool<T>(
  items: readonly T[],
  size: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: size }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
        await fn(item);
      }
    }),
  );
}

async function main(): Promise<void> {
  assertDisposableServer();
  const tenantCount = numberFlag("tenants", 200);
  const workers = numberFlag("workers", 40);
  const seconds = numberFlag("seconds", 60);
  const seed = numberFlag("seed", 1);
  const warmup = numberFlag("warmup", 0);
  const rate = numberFlag("rate", 0);
  const hotFraction = hasFlag("uniform") ? 1 : numberFlag("hot", 0.2);
  const hotShare = hasFlag("uniform") ? 1 : numberFlag("hot-share", 0.8);
  const mix = parseMix(flagValue("mix") ?? DEFAULT_MIX);
  const out = flagValue("out");
  const runId = `r${Date.now().toString(36)}`;

  configureTenantPool({
    ...(flagValue("max-active") ? { maxActive: numberFlag("max-active", 50) } : {}),
    ...(flagValue("pool-size") ? { poolSize: numberFlag("pool-size", 2) } : {}),
    ...(flagValue("max-connections") ? { maxConnections: numberFlag("max-connections", 60) } : {}),
  });

  const tenants = await loadTenants(tenantCount);
  if (tenants.length < tenantCount) {
    console.warn(
      `Solo hay ${tenants.length} negocios «${SLUG_PREFIX}…» activos (se pidieron ${tenantCount}).`,
    );
  }
  await inPool(tenants, 8, prepare);
  const prepStats = tenantPoolStats();
  console.log(
    `Preparados ${tenants.length} negocios (el administrador abrió ${prepStats.created} y cerró ${prepStats.evicted} conexiones de negocio).`,
  );

  // Reparto de la carga: unos pocos negocios «calientes» reciben la mayor parte; el resto, poco.
  const shuffle = seededRandom(seed);
  const floodWorkers = numberFlag("flood", 0);
  const flooded = floodWorkers > 0 ? tenants[0] : undefined;
  const order = tenants.filter((tenant) => tenant !== flooded).sort(() => shuffle() - 0.5);
  const hotCount = Math.max(1, Math.round(order.length * hotFraction));
  const hot = order.slice(0, hotCount);
  const cold = order.slice(hotCount);
  const pickTenant = (random: () => number): TenantState => {
    const pool = cold.length === 0 || random() < hotShare ? hot : cold;
    return pool[Math.floor(random() * pool.length)] as TenantState;
  };

  const hotIds = new Set(hot.map((tenant) => tenant.slug));
  const byClass = { hot: new Latencies(), neighbours: new Latencies() };
  const latencies = new Map<Op, Latencies>();
  const errors = new Map<string, number>();
  const completed: Record<string, number> = {};
  for (const [op] of mix) {
    latencies.set(op, new Latencies());
  }
  const adminUrl = process.env.TENANT_PROVISIONING_URL as string;
  const server = watchServerConnections(adminUrl);
  const proc = watchProcess();
  const statsBefore = tenantPoolStats();

  const sellerOf = (tenant: TenantState) => ({ id: tenant.ownerId, role: "OWNER" as const });
  let saleSerial = 0;

  const run = async (tenant: TenantState, op: Op, random: () => number): Promise<void> => {
    await runWithTenant(tenant.ref, async () => {
      switch (op) {
        case "sale": {
          const lines = Array.from({ length: 1 + Math.floor(random() * 3) }, () => ({
            variantId: (
              tenant.variants[Math.floor(random() * tenant.variants.length)] as { id: string }
            ).id,
            quantity: 1,
          }));
          const clientRequestId = `${runId}:${tenant.slug}:${(saleSerial += 1)}`;
          const units = lines.length;
          // Como haría el cajero: si algo falla de forma extraña, se reenvía el mismo cobro (idempotente).
          for (let attempt = 0; ; attempt += 1) {
            try {
              await completeSale(sellerOf(tenant), {
                clientRequestId,
                lines,
                payments: [{ method: "CASH", amountCents: 500_000 }],
              });
              tenant.confirmed += 1;
              tenant.soldUnits += units;
              return;
            } catch (error) {
              if (attempt >= 2) {
                tenant.uncertain += 1;
                throw error;
              }
              tenant.retried += 1;
              errors.set(classifyError(error), (errors.get(classifyError(error)) ?? 0) + 1);
              await sleep(100);
            }
          }
        }
        case "search":
          await searchSellable({
            q: ["vestido", "blusa", "camisa", "prenda", ""][Math.floor(random() * 5)],
          });
          return;
        case "lookup": {
          const variant = tenant.variants[Math.floor(random() * tenant.variants.length)];
          if (variant?.barcode) {
            await lookupCode(variant.barcode);
          }
          return;
        }
        case "dashboard":
          await getDashboard(reportAccess({ id: tenant.ownerId, role: "OWNER" }));
          return;
        case "list":
          await listSales({ page: 1 }, {});
          return;
        case "login":
          await login({ username: "cajero", password: OWNER_PASSWORD });
          return;
      }
    });
  };

  console.log(
    `Carga: ${tenants.length} negocios (${hot.length} calientes con el ${Math.round(hotShare * 100)} % del tráfico), ${workers} trabajadores, ${seconds} s` +
      (rate ? `, ritmo ${rate} operaciones/s` : ", a tope") +
      `, presupuesto de ${tenantPoolStats().maxConnections} conexiones (${tenantPoolStats().capacity} negocios abiertos × ${tenantPoolStats().poolSize}).`,
  );
  // Calentamiento: la carga corre igual pero no se cuenta. Cada negocio guarda sus planes de consulta ya armados; con tráfico parejo
  // sobre cientos de negocios, el arranque en frío pesa más que el régimen estable.
  const measureAt = Date.now() + warmup * 1000;
  const deadline = measureAt + seconds * 1000;
  const startedAt = performance.now() + warmup * 1000;
  let measuredSales = 0;
  const interval = rate ? (workers * 1000) / rate : 0;
  const flood = new Latencies();
  const floodWork = flooded
    ? Array.from({ length: floodWorkers }, async (_, worker) => {
        const random = seededRandom(seed * 7919 + worker);
        while (Date.now() < deadline) {
          const op = weightedPick<Op>(random, [
            ["sale", 50],
            ["dashboard", 30],
            ["list", 20],
          ]);
          const at = performance.now();
          try {
            await run(flooded, op, random);
            flood.add(performance.now() - at);
          } catch (error) {
            const family = `inundado ${op}: ${classifyError(error)}`;
            errors.set(family, (errors.get(family) ?? 0) + 1);
          }
        }
      })
    : [];
  await Promise.all([
    ...floodWork,
    ...Array.from({ length: workers }, async (_, worker) => {
      const random = seededRandom(seed * 1000 + worker);
      let nextAt = Date.now() + random() * interval;
      while (Date.now() < deadline) {
        if (interval) {
          const wait = nextAt - Date.now();
          if (wait > 0) {
            await sleep(wait);
          }
          nextAt += interval;
        }
        const tenant = pickTenant(random);
        const op = weightedPick(random, mix);
        const counting = Date.now() >= measureAt;
        const at = performance.now();
        try {
          await run(tenant, op, random);
          if (counting) {
            const took = performance.now() - at;
            (latencies.get(op) as Latencies).add(took);
            (hotIds.has(tenant.slug) ? byClass.hot : byClass.neighbours).add(took);
            completed[op] = (completed[op] ?? 0) + 1;
            if (op === "sale") {
              measuredSales += 1;
            }
          }
        } catch (error) {
          if (counting) {
            const family = classifyError(error);
            errors.set(`${op}: ${family}`, (errors.get(`${op}: ${family}`) ?? 0) + 1);
          }
        }
      }
    }),
  ]);
  const elapsed = (performance.now() - startedAt) / 1000;
  const serverResult = server.stop();
  const processResult = proc.stop();
  const statsAfter = tenantPoolStats();

  // ── Verificación: nada se mezcló, nada se perdió y los libros cuadran, negocio por negocio (se corre después del informe) ──
  const problems: string[] = [];
  let verifyRetries = 0;
  const verifyTenant = async (tenant: TenantState): Promise<string[]> =>
    runWithTenant(tenant.ref, async () => {
      const found: string[] = [];
      const own = `${runId}:${tenant.slug}:`;
      const inDb = await db.sale.count({ where: { clientRequestId: { startsWith: own } } });
      const foreign = await db.sale.count({
        where: { clientRequestId: { startsWith: `${runId}:`, not: { startsWith: own } } },
      });
      if (foreign > 0) {
        found.push(`${tenant.slug}: ${foreign} ventas de OTRO negocio en su base (mezcla)`);
      }
      if (inDb < tenant.confirmed || inDb > tenant.confirmed + tenant.uncertain) {
        found.push(
          `${tenant.slug}: la base tiene ${inDb} ventas y el cliente confirmó ${tenant.confirmed} (+${tenant.uncertain} dudosas)`,
        );
      }
      const stock = await db.stockLevel.aggregate({
        where: { variantId: { in: tenant.variants.map((variant) => variant.id) } },
        _sum: { onHand: true },
      });
      const sold = tenant.stockBefore - (stock._sum.onHand ?? 0);
      if (tenant.uncertain === 0 && sold !== tenant.soldUnits) {
        found.push(
          `${tenant.slug}: se vendieron ${tenant.soldUnits} prendas y el inventario bajó ${sold}`,
        );
      }
      const books = await verifyBooks(db);
      if (!books.ok) {
        found.push(
          `${tenant.slug}: libros descuadrados — ${books.problems.map((p) => p.detail).join("; ")}`,
        );
      }
      return found;
    });
  const verifyAll = (): Promise<void> =>
    inPool(tenants, 4, async (tenant) => {
      for (let attempt = 1; ; attempt += 1) {
        try {
          problems.push(...(await verifyTenant(tenant)));
          return;
        } catch (error) {
          if (attempt >= 4) {
            problems.push(`${tenant.slug}: no se pudo verificar — ${classifyError(error)}`);
            return;
          }
          verifyRetries += 1;
          await sleep(3000);
        }
      }
    });

  // ── Informe ──
  const totalOps = Object.values(completed).reduce((sum, value) => sum + value, 0);
  const totalErrors = [...errors.values()].reduce((sum, value) => sum + value, 0);
  const sales = measuredSales;
  printTable("Latencia por operación (ms)", [
    ["operación", "hechas", "media", "p50", "p95", "p99", "máx"],
    ...mix.map(([op]) => {
      const s = (latencies.get(op) as Latencies).summary();
      return [op, s.count, s.mean, s.p50, s.p95, s.p99, s.max];
    }),
  ]);
  const hotSummary = byClass.hot.summary();
  const neighbourSummary = byClass.neighbours.summary();
  printTable("Calientes contra vecinos (ms, todas las operaciones)", [
    ["", "hechas", "p50", "p95", "p99"],
    [`calientes (${hot.length})`, hotSummary.count, hotSummary.p50, hotSummary.p95, hotSummary.p99],
    [
      `demás negocios (${cold.length})`,
      neighbourSummary.count,
      neighbourSummary.p50,
      neighbourSummary.p95,
      neighbourSummary.p99,
    ],
  ]);
  if (flooded) {
    const floodSummary = flood.summary();
    printTable("Negocio inundado (castigado a propósito por trabajadores extra)", [
      ["", "hechas", "p50", "p95", "p99"],
      [flooded.slug, floodSummary.count, floodSummary.p50, floodSummary.p95, floodSummary.p99],
    ]);
  }
  printTable("Resultado", [
    ["operaciones completadas", `${totalOps} (${(totalOps / elapsed).toFixed(1)} por segundo)`],
    ["ventas confirmadas", `${sales} (${(sales / elapsed).toFixed(1)} por segundo)`],
    ["errores (incluye los reintentos de cobro)", totalErrors],
    ["cobros reenviados y resueltos", tenants.reduce((sum, tenant) => sum + tenant.retried, 0)],
    ["cobros que quedaron dudosos", tenants.reduce((sum, tenant) => sum + tenant.uncertain, 0)],
    [
      "conexiones a Postgres (máx. / media / de negocios)",
      `${serverResult.peakConnections} / ${serverResult.meanConnections} / ${serverResult.peakTenantConnections}`,
    ],
    [
      "administrador de conexiones",
      `abrió ${statsAfter.created - statsBefore.created}, cerró ${statsAfter.evicted - statsBefore.evicted}, esperaron lugar ${statsAfter.waited - statsBefore.waited} (vencieron ${statsAfter.timedOut - statsBefore.timedOut}), abiertos al final ${statsAfter.active}`,
    ],
    [
      "memoria del proceso (máx. / tendencia al final)",
      `${processResult.peakRssMb} MB / ${processResult.rssSlopeMbPerMin} MB por minuto`,
    ],
    [
      "memoria viva tras recolectar (serie cada 10 s / tendencia)",
      processResult.heapSlopeMbPerMin === null
        ? "(corre con NODE_OPTIONS=--expose-gc para medirla)"
        : `${processResult.heapSeries.join(" → ")} MB / ${processResult.heapSlopeMbPerMin} MB por minuto`,
    ],
    [
      "retraso del bucle de eventos (p99 / máx)",
      `${processResult.eventLoopP99Ms} ms / ${processResult.eventLoopMaxMs} ms`,
    ],
    ["duración", `${elapsed.toFixed(1)} s`],
  ]);
  if (errors.size > 0) {
    printTable(
      "Errores por tipo",
      [...errors.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => [count, name]),
    );
  }
  await verifyAll();
  if (verifyRetries > 0) {
    console.log(`(la verificación reintentó ${verifyRetries} veces por conexiones agotadas)`);
  }
  console.log(
    problems.length === 0
      ? `\nVerificación: ${tenants.length} negocios sin mezclas, con sus ventas, su inventario y sus libros al día.`
      : `\nVERIFICACIÓN FALLIDA (${problems.length}):\n${problems
          .slice(0, 20)
          .map((p) => `  ${p}`)
          .join("\n")}`,
  );

  if (out) {
    writeFileSync(
      out,
      JSON.stringify(
        {
          tenants: tenants.length,
          workers,
          seconds,
          rate,
          hotFraction,
          hotShare,
          pool: {
            capacity: statsAfter.capacity,
            maxConnections: statsAfter.maxConnections,
            poolSize: statsAfter.poolSize,
          },
          completed,
          perSecond: totalOps / elapsed,
          salesPerSecond: sales / elapsed,
          latency: Object.fromEntries(
            mix.map(([op]) => [op, (latencies.get(op) as Latencies).summary()]),
          ),
          flood: flooded
            ? { slug: flooded.slug, workers: floodWorkers, latency: flood.summary() }
            : null,
          hotLatency: hotSummary,
          neighbourLatency: neighbourSummary,
          errors: Object.fromEntries(errors),
          server: serverResult,
          pools: {
            created: statsAfter.created - statsBefore.created,
            evicted: statsAfter.evicted - statsBefore.evicted,
            waited: statsAfter.waited - statsBefore.waited,
            timedOut: statsAfter.timedOut - statsBefore.timedOut,
          },
          process: processResult,
          problems,
        },
        null,
        2,
      ),
    );
  }
  if (problems.length > 0) {
    process.exitCode = 1;
  }
  await closeAllTenantClients();
}

main()
  .catch(reportScriptError)
  .finally(async () => {
    await finishScript();
    await closeControlDb();
  });
