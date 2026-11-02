import { monitorEventLoopDelay } from "node:perf_hooks";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../src/generated/prisma/client";
import { flagValue, UsageError } from "../lib/tenant-run";

/**
 * Piezas comunes de las pruebas de capacidad (Etapa 6). Estos guiones **crean cientos de negocios y los cargan a propósito**:
 * solo corren contra un servidor desechable, y para que nadie los apunte a una instalación real por descuido exigen que se
 * escriba el nombre de la base central en `CAPACITY_CONFIRM` (ver docs/SAAS_ETAPA_6.md).
 */

export const SLUG_PREFIX = "cap-";
export const OWNER_USERNAME = "dueno";
export const OWNER_PASSWORD = "Capacidad-2026";
export const LOAD_PRODUCT_CODE = "CAP-1";

export function slugFor(index: number): string {
  return `${SLUG_PREFIX}${String(index).padStart(4, "0")}`;
}

export function assertDisposableServer(): void {
  const control = process.env.CONTROL_DATABASE_URL ?? "";
  let name = "";
  try {
    name = new URL(control).pathname.slice(1);
  } catch {
    // sin URL válida, el siguiente control falla igual
  }
  if (process.env.DEPLOYMENT === "production") {
    throw new UsageError(
      "Las pruebas de capacidad no corren con DEPLOYMENT=production: usa un servidor desechable.",
    );
  }
  if (!name || process.env.CAPACITY_CONFIRM !== name) {
    throw new UsageError(
      `Este guion crea y carga cientos de negocios. Para confirmar que el servidor es desechable, define CAPACITY_CONFIRM=${name || "<base central>"}.`,
    );
  }
}

export function numberFlag(name: string, fallback: number): number {
  const raw = flagValue(name);
  if (raw === undefined) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new UsageError(`--${name} debe ser un número.`);
  }
  return value;
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export type LatencySummary = {
  count: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
};

export class Latencies {
  private readonly values: number[] = [];

  add(ms: number): void {
    this.values.push(ms);
  }

  summary(): LatencySummary {
    const sorted = [...this.values].sort((a, b) => a - b);
    const at = (fraction: number): number =>
      Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0);
    const total = sorted.reduce((sum, value) => sum + value, 0);
    return {
      count: sorted.length,
      mean: sorted.length ? Math.round(total / sorted.length) : 0,
      p50: at(0.5),
      p95: at(0.95),
      p99: at(0.99),
      max: Math.round(sorted[sorted.length - 1] ?? 0),
    };
  }
}

/** Agrupa los errores en pocas familias para que el informe diga qué pasó sin una lista de mil líneas. */
export function classifyError(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (/too many clients|remaining connection slots|connection limit/i.test(text)) {
    return "límite de conexiones";
  }
  if (/P2028|Transaction API error|transaction already closed|expired transaction/i.test(text)) {
    return "transacción vencida";
  }
  if (/timeout|timed out|canceling statement/i.test(text)) {
    return "tiempo agotado";
  }
  if (
    /terminat|ECONNRESET|ECONNREFUSED|Connection (terminated|closed)|socket hang up/i.test(text)
  ) {
    return "conexión perdida";
  }
  if (/P2034|deadlock|could not serialize/i.test(text)) {
    return "conflicto de concurrencia";
  }
  return `otro: ${text.replace(/\s+/g, " ").slice(0, 140)}`;
}

export type ServerWatch = {
  stop: () => {
    peakConnections: number;
    peakTenantConnections: number;
    meanConnections: number;
    samples: number;
  };
};

/**
 * Cuenta cada medio segundo cuántas conexiones de clientes hay abiertas en Postgres (el límite que se agota primero con
 * muchos negocios). Usa la cuenta de aprovisionamiento, que es la que puede ver todas las sesiones.
 */
export function watchServerConnections(adminUrl: string, intervalMs = 500): ServerWatch {
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: adminUrl, max: 1 }),
  });
  let peak = 0;
  let peakTenant = 0;
  let sum = 0;
  let samples = 0;
  let busy = false;
  const timer = setInterval(() => {
    if (busy) {
      return;
    }
    busy = true;
    client.$queryRaw<
      { total: bigint; tenants: bigint }[]
    >`SELECT count(*)::bigint AS total, count(*) FILTER (WHERE left(datname, 2) = 't_')::bigint AS tenants FROM pg_stat_activity WHERE backend_type = 'client backend' AND pid <> pg_backend_pid()`
      .then((rows) => {
        const total = Number(rows[0]?.total ?? 0);
        peak = Math.max(peak, total);
        peakTenant = Math.max(peakTenant, Number(rows[0]?.tenants ?? 0));
        sum += total;
        samples += 1;
      })
      .catch(() => undefined)
      .finally(() => {
        busy = false;
      });
  }, intervalMs);
  return {
    stop: () => {
      clearInterval(timer);
      void client.$disconnect().catch(() => undefined);
      return {
        peakConnections: peak,
        peakTenantConnections: peakTenant,
        meanConnections: samples ? Math.round(sum / samples) : 0,
        samples,
      };
    },
  };
}

export type ProcessWatch = {
  peakRssMb: number;
  eventLoopP99Ms: number;
  eventLoopMaxMs: number;
  /** Memoria (MB) tomada cada 10 s: sirve para ver si sube sin parar (fuga) o se estabiliza. */
  rssSeries: number[];
  /** Pendiente de la memoria después del calentamiento, en MB por minuto (cerca de 0 = estable). */
  rssSlopeMbPerMin: number;
  /**
   * Con `node --expose-gc`: memoria JavaScript viva (MB) tras forzar el recolector cada 10 s, y su pendiente en MB por minuto.
   * Es la prueba de fuga de verdad: la basura todavía sin recoger no cuenta; si esta pendiente sube sin parar, algo se retiene.
   */
  heapSeries: number[];
  heapSlopeMbPerMin: number | null;
};

function slopePerMinute(values: readonly number[], intervalMs: number): number {
  if (values.length < 5) {
    return 0;
  }
  const n = values.length;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((sum, value) => sum + value, 0) / n;
  let num = 0;
  let den = 0;
  values.forEach((value, index) => {
    num += (index - meanX) * (value - meanY);
    den += (index - meanX) ** 2;
  });
  return Math.round((num / den) * (60_000 / intervalMs) * 10) / 10;
}

/** Memoria y retraso del bucle de eventos de ESTE proceso mientras corre la carga. */
export function watchProcess(intervalMs = 1000): { stop: () => ProcessWatch } {
  const delay = monitorEventLoopDelay({ resolution: 10 });
  delay.enable();
  let peak = process.memoryUsage().rss;
  const samples: number[] = [];
  const heap: number[] = [];
  const collect = (globalThis as { gc?: () => void }).gc;
  let ticks = 0;
  const timer = setInterval(() => {
    const rss = process.memoryUsage().rss;
    peak = Math.max(peak, rss);
    samples.push(rss / 1024 / 1024);
    ticks += 1;
    if (collect && ticks % 10 === 0) {
      collect();
      heap.push(process.memoryUsage().heapUsed / 1024 / 1024);
    }
  }, intervalMs);
  return {
    stop: () => {
      clearInterval(timer);
      delay.disable();
      peak = Math.max(peak, process.memoryUsage().rss);
      // Se salta el primer tercio (calentamiento).
      const tail = samples.slice(Math.floor(samples.length / 3));
      const heapTail = heap.slice(Math.floor(heap.length / 3));
      return {
        peakRssMb: Math.round(peak / 1024 / 1024),
        eventLoopP99Ms: Math.round(delay.percentile(99) / 1e6),
        eventLoopMaxMs: Math.round(delay.max / 1e6),
        rssSeries: samples.filter((_, index) => index % 10 === 9).map((value) => Math.round(value)),
        rssSlopeMbPerMin: slopePerMinute(tail, intervalMs),
        heapSeries: heap.map((value) => Math.round(value)),
        heapSlopeMbPerMin: heap.length >= 5 ? slopePerMinute(heapTail, 10_000) : null,
      };
    },
  };
}

/** Sortea con pesos: `pick(random, [["sale", 55], ["search", 15]])`. */
export function weightedPick<T>(
  random: () => number,
  options: readonly (readonly [T, number])[],
): T {
  const total = options.reduce((sum, [, weight]) => sum + weight, 0);
  let draw = random() * total;
  for (const [value, weight] of options) {
    draw -= weight;
    if (draw < 0) {
      return value;
    }
  }
  return (options[options.length - 1] as readonly [T, number])[0];
}

/** Generador pseudoaleatorio reproducible (el mismo reparto de carga en cada corrida con la misma semilla). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function printTable(title: string, rows: readonly (readonly (string | number)[])[]): void {
  console.log(`\n${title}`);
  const widths = rows.reduce<number[]>((acc, row) => {
    row.forEach((cell, index) => {
      acc[index] = Math.max(acc[index] ?? 0, String(cell).length);
    });
    return acc;
  }, []);
  for (const row of rows) {
    console.log(
      `  ${row.map((cell, index) => String(cell).padEnd(widths[index] ?? 0)).join("  ")}`,
    );
  }
}
