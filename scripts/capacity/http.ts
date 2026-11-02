import "dotenv/config";

import { execFile } from "node:child_process";
import { writeFileSync } from "node:fs";
import http from "node:http";

import { tenantRefFromRecord, type TenantRecord } from "../../src/lib/tenancy/control-directory";
import { closeControlDb, controlDb } from "../../src/lib/tenancy/control-db";
import { runWithTenant } from "../../src/lib/tenancy/tenant-context";
import { serverEndpoint } from "../../src/lib/tenancy/tenant-url";
import { getVault } from "../../src/lib/tenancy/vault";
import { login } from "../../src/modules/auth/service";
import { finishScript, flagValue, reportScriptError } from "../lib/tenant-run";
import {
  assertDisposableServer,
  Latencies,
  numberFlag,
  OWNER_PASSWORD,
  OWNER_USERNAME,
  printTable,
  seededRandom,
  sleep,
  SLUG_PREFIX,
  watchServerConnections,
  weightedPick,
} from "./common";

/**
 * Carga «por la puerta»: peticiones HTTP reales a la aplicación ya compilada (`pnpm build && pnpm start`) en modo multi-negocio,
 * una por página, con la cookie de sesión de cada negocio, repartidas entre todos los subdominios. Mide lo que ve una persona
 * (páginas completas) y revisa **en cada respuesta** que no aparece el nombre de OTRO negocio.
 *
 *   CAPACITY_CONFIRM=<base central> pnpm capacity:http [--tenants 200] [--workers 30] [--seconds 60] [--port 3300]
 *        [--server-pid 123,456] [--rate <peticiones por segundo>] [--uniform] [--out resultado.json]
 *
 * Los negocios de prueba (`capacity:provision`) llevan su subdominio (`cap-0007`) en el nombre de cada producto y del dueño.
 */

type Target = { slug: string; token: string };

const PATHS: readonly (readonly [string, number])[] = [
  ["/", 25],
  ["/productos", 20],
  ["/ventas", 20],
  ["/vender", 20],
  ["/reportes/ventas", 10],
  ["/api/health", 5],
];

const agentFor = (sockets: number) => new http.Agent({ keepAlive: true, maxSockets: sockets });

function get(
  agent: http.Agent,
  port: number,
  host: string,
  path: string,
  cookie: string,
): Promise<{ status: number; body: string; ms: number }> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "GET",
        agent,
        headers: { host, cookie, "accept-encoding": "identity", accept: "text/html" },
        timeout: 60_000,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
            ms: performance.now() - started,
          }),
        );
        response.on("error", reject);
      },
    );
    request.on("timeout", () => request.destroy(new Error("timeout de 60 s")));
    request.on("error", reject);
    request.end();
  });
}

type ProcessInfo = { rssMb: number; cpuMs: number };

/** Memoria (MB) y CPU acumulada (ms) de un proceso del sistema; `null` si no se pudo leer. */
function processInfo(pid: number): Promise<ProcessInfo | null> {
  return new Promise((resolve) => {
    const done = (error: unknown, stdout: string, rssIsKb: boolean) => {
      const [memory, cpu] = stdout.trim().split(/\s+/).map(Number);
      if (error || memory === undefined || cpu === undefined || Number.isNaN(memory + cpu)) {
        resolve(null);
        return;
      }
      resolve({ rssMb: Math.round(memory / (rssIsKb ? 1024 : 1024 * 1024)), cpuMs: cpu });
    };
    if (process.platform === "win32") {
      execFile(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `$p = Get-Process -Id ${pid}; '{0} {1}' -f $p.WorkingSet64, [math]::Round($p.CPU * 1000)`,
        ],
        (error, stdout) => done(error, stdout, false),
      );
    } else {
      execFile("ps", ["-o", "rss=,cputimes=", "-p", String(pid)], (error, stdout) => {
        const [rss, seconds] = stdout.trim().split(/\s+/).map(Number);
        done(error, `${(rss ?? 0) * 1024} ${(seconds ?? 0) * 1000}`, false);
      });
    }
  });
}

async function main(): Promise<void> {
  assertDisposableServer();
  const tenantCount = numberFlag("tenants", 200);
  const workers = numberFlag("workers", 30);
  const seconds = numberFlag("seconds", 60);
  const port = numberFlag("port", 3300);
  const rate = numberFlag("rate", 0);
  const seed = numberFlag("seed", 1);
  const serverPids = (flagValue("server-pid") ?? "")
    .split(",")
    .map(Number)
    .filter((pid) => Number.isInteger(pid) && pid > 0);
  const out = flagValue("out");

  // ── 1. Una sesión por negocio (lo que haría el dueño al entrar por la mañana) ──
  const vault = getVault();
  const records: TenantRecord[] = await controlDb.tenant.findMany({
    where: { status: "ACTIVE", slug: { startsWith: SLUG_PREFIX } },
    orderBy: { slug: "asc" },
    take: tenantCount,
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
  const targets: Target[] = [];
  const queue = [...records];
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      for (let record = queue.shift(); record; record = queue.shift()) {
        const ref = tenantRefFromRecord(record, { vault, endpointFor: serverEndpoint });
        const session = await runWithTenant(ref, () =>
          login({ username: OWNER_USERNAME, password: OWNER_PASSWORD }),
        );
        targets.push({ slug: record.slug, token: session.token });
      }
    }),
  );
  targets.sort((a, b) => a.slug.localeCompare(b.slug));
  console.log(`Sesiones listas en ${targets.length} negocios.`);

  // Arranque en frío: una petición por negocio (carga el directorio, abre su conexión, calienta las páginas).
  const agent = agentFor(workers);
  const cold = new Latencies();
  const coldQueue = [...targets];
  let coldFailures = 0;
  await Promise.all(
    Array.from({ length: Math.min(workers, 8) }, async () => {
      for (let target = coldQueue.shift(); target; target = coldQueue.shift()) {
        try {
          const response = await get(
            agent,
            port,
            `${target.slug}.localhost:${port}`,
            "/",
            `boutique_session=${target.token}`,
          );
          cold.add(response.ms);
          if (response.status !== 200) {
            coldFailures += 1;
          }
        } catch {
          coldFailures += 1;
        }
      }
    }),
  );

  // ── 2. Carga ──
  const server = watchServerConnections(process.env.TENANT_PROVISIONING_URL as string);
  const perPath = new Map<string, Latencies>(PATHS.map(([path]) => [path, new Latencies()]));
  const statuses = new Map<string, number>();
  const failures = new Map<string, number>();
  const leaks: string[] = [];
  const missing: string[] = [];
  let served = 0;
  const serverMemory: number[] = [];
  // CPU acumulada de la aplicación al empezar y al terminar: la diferencia dice cuántos núcleos usó en promedio.
  const cpuAtStart = new Map<number, number>();
  const cpuAtEnd = new Map<number, number>();
  for (const pid of serverPids) {
    const info = await processInfo(pid);
    if (info) {
      cpuAtStart.set(pid, info.cpuMs);
    }
  }
  const memoryTimer = setInterval(() => {
    for (const pid of serverPids) {
      void processInfo(pid).then((info) => {
        if (info !== null) {
          serverMemory.push(info.rssMb);
          cpuAtEnd.set(pid, info.cpuMs);
        }
      });
    }
  }, 2000);

  const interval = rate ? (workers * 1000) / rate : 0;
  const deadline = Date.now() + seconds * 1000;
  const startedAt = performance.now();
  const hot = targets.slice(0, Math.max(1, Math.round(targets.length * 0.2)));
  await Promise.all(
    Array.from({ length: workers }, async (_, worker) => {
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
        const pool = process.argv.includes("--uniform") || random() < 0.2 ? targets : hot;
        const target = pool[Math.floor(random() * pool.length)] as Target;
        const path = weightedPick(random, PATHS);
        try {
          const response = await get(
            agent,
            port,
            `${target.slug}.localhost:${port}`,
            path,
            `boutique_session=${target.token}`,
          );
          (perPath.get(path) as Latencies).add(response.ms);
          statuses.set(
            `${path} → ${response.status}`,
            (statuses.get(`${path} → ${response.status}`) ?? 0) + 1,
          );
          served += 1;
          const seen = new Set(response.body.match(/cap-\d{4}/g) ?? []);
          for (const found of seen) {
            if (found !== target.slug) {
              leaks.push(`${target.slug}${path}: aparece «${found}»`);
            }
          }
          if (path === "/productos" && response.status === 200 && !seen.has(target.slug)) {
            missing.push(`${target.slug}${path}: no aparece su propio nombre`);
          }
        } catch (error) {
          const text = error instanceof Error ? error.message : String(error);
          failures.set(
            `${path}: ${text.slice(0, 80)}`,
            (failures.get(`${path}: ${text.slice(0, 80)}`) ?? 0) + 1,
          );
        }
      }
    }),
  );
  clearInterval(memoryTimer);
  const elapsed = (performance.now() - startedAt) / 1000;
  const serverResult = server.stop();
  agent.destroy();

  // ── 3. Informe ──
  let serverCores: number | null = null;
  for (const [pid, start] of cpuAtStart) {
    const end = cpuAtEnd.get(pid);
    if (end !== undefined) {
      serverCores = (serverCores ?? 0) + (end - start) / 1000 / elapsed;
    }
  }
  const bad = [...statuses.entries()].filter(([key]) => !key.endsWith("→ 200"));
  const failureCount = [...failures.values()].reduce((sum, value) => sum + value, 0);
  const coldSummary = cold.summary();
  printTable("Latencia por página (ms)", [
    ["página", "hechas", "media", "p50", "p95", "p99", "máx"],
    ...PATHS.map(([path]) => {
      const s = (perPath.get(path) as Latencies).summary();
      return [path, s.count, s.mean, s.p50, s.p95, s.p99, s.max];
    }),
  ]);
  printTable("Resultado", [
    ["peticiones atendidas", `${served} (${(served / elapsed).toFixed(1)} por segundo)`],
    ["respuestas que no fueron 200", bad.reduce((sum, [, count]) => sum + count, 0)],
    ["peticiones sin respuesta", failureCount],
    ["MEZCLAS (otro negocio en la página)", leaks.length],
    ["páginas sin su propio nombre", missing.length],
    [
      "primera petición a cada negocio (p50 / p95 / máx)",
      `${coldSummary.p50} / ${coldSummary.p95} / ${coldSummary.max} ms (${coldFailures} fallas)`,
    ],
    [
      "conexiones a Postgres (máx. / media / de negocios)",
      `${serverResult.peakConnections} / ${serverResult.meanConnections} / ${serverResult.peakTenantConnections}`,
    ],
    [
      "memoria de la aplicación (máx.)",
      serverMemory.length ? `${Math.max(...serverMemory)} MB` : "(sin --server-pid)",
    ],
    [
      "CPU de la aplicación (núcleos en promedio)",
      serverCores === null ? "(sin --server-pid)" : serverCores.toFixed(2),
    ],
    ["duración", `${elapsed.toFixed(1)} s`],
  ]);
  if (bad.length > 0 || failures.size > 0) {
    printTable("Respuestas anómalas", [
      ...bad.map(([key, count]) => [count, key]),
      ...[...failures.entries()].map(([key, count]) => [count, `sin respuesta — ${key}`]),
    ]);
  }
  for (const line of [...leaks.slice(0, 10), ...missing.slice(0, 5)]) {
    console.error(`  ${line}`);
  }
  if (out) {
    writeFileSync(
      out,
      JSON.stringify(
        {
          tenants: targets.length,
          workers,
          seconds,
          rate,
          served,
          perSecond: served / elapsed,
          latency: Object.fromEntries(
            PATHS.map(([path]) => [path, (perPath.get(path) as Latencies).summary()]),
          ),
          statuses: Object.fromEntries(statuses),
          failures: Object.fromEntries(failures),
          leaks: leaks.length,
          missing: missing.length,
          cold: coldSummary,
          server: serverResult,
          serverMemoryMb: serverMemory.length ? Math.max(...serverMemory) : null,
          serverCores,
        },
        null,
        2,
      ),
    );
  }
  if (leaks.length > 0 || bad.length > 0 || failureCount > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch(reportScriptError)
  .finally(async () => {
    await finishScript();
    await closeControlDb();
  });
