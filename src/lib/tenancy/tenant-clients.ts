import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { logger } from "@/lib/logger";
import type { TenantRef } from "@/lib/tenancy/tenant-context";

/**
 * Administrador de conexiones: un cliente de Prisma (con su pool pequeño) por negocio, creado al primer uso y cerrado cuando
 * lleva rato sin usarse o cuando hace falta lugar para otro. Nunca se cierra un cliente con operaciones en curso.
 *
 * **Presupuesto de conexiones (Etapa 6).** Cada negocio abierto puede retener hasta `poolSize` conexiones a Postgres, y Postgres
 * tiene un tope duro (`max_connections`, 100 de fábrica). Con cientos de negocios activos a la vez, abrirlos todos agotaría
 * el servidor y fallaría TODO el mundo (se midió: pico de 96 conexiones y cientos de errores). Por eso el tope real de
 * negocios abiertos es `min(maxActive, maxConnections / poolSize)`, y cuando un negocio nuevo pide lugar y todos los abiertos
 * están ocupados, **espera** (poco: lo que dura una venta) en vez de abrir de más. Si la espera pasa de `waitMs` falla con
 * `TenantPoolBusyError` (mejor un error limpio que se puede reintentar que tumbar la base de todos).
 * Detrás de un PgBouncer (docs/RUNBOOK.md §17) el presupuesto se sube: las conexiones son hacia PgBouncer, no hacia Postgres.
 */

export type PoolOptions = {
  /** Tope de negocios con cliente abierto a la vez (por instancia de la app): lo limita la memoria (≈ 7 MB cada uno). */
  maxActive: number;
  /** Tope de conexiones a la base de datos que esta instancia puede tener abiertas hacia los negocios, todas sumadas. */
  maxConnections: number;
  /** Conexiones por negocio. */
  poolSize: number;
  /** Cuánto sin usarse antes de cerrar el cliente de un negocio. */
  idleMs: number;
  /** Cuánto puede quedar abierta una conexión ociosa antes de cerrarse. */
  connectionIdleMs: number;
  /** Cuánto espera una operación por una conexión libre de su negocio antes de fallar. */
  connectionTimeoutMs: number;
  /** Cuánto espera un negocio sin cliente abierto a que se libere un lugar. */
  waitMs: number;
};

/** 60 de las 100 conexiones de un Postgres de fábrica: el resto queda para la base central, los respaldos y el mantenimiento. */
const DEFAULT_OPTIONS: PoolOptions = {
  maxActive: 100,
  maxConnections: 60,
  poolSize: 2,
  idleMs: 5 * 60_000,
  connectionIdleMs: 10_000,
  connectionTimeoutMs: 10_000,
  waitMs: 10_000,
};
const SWEEP_EVERY_MS = 60_000;

/** El administrador no pudo darle lugar a un negocio en `waitMs`: la instancia está saturada. Se puede reintentar. */
export class TenantPoolBusyError extends Error {
  constructor() {
    super(
      "Hay demasiados negocios atendiéndose a la vez en este servidor; intenta de nuevo en un momento",
    );
    this.name = "TenantPoolBusyError";
  }
}

type Entry = {
  client: PrismaClient;
  databaseUrl: string;
  lastUsed: number;
  inFlight: number;
};

type Waiter = { wake: () => void; timer: ReturnType<typeof setTimeout> };

type Registry = {
  entries: Map<string, Entry>;
  waiters: Waiter[];
  options: PoolOptions;
  created: number;
  evicted: number;
  waited: number;
  timedOut: number;
  sweeper?: ReturnType<typeof setInterval>;
};

const globalRegistry = globalThis as typeof globalThis & { __boutiqueTenantClients?: Registry };

function intFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/** Los valores de fábrica, ajustados con las variables `TENANT_POOL_*` (ver docs/RUNBOOK.md §17). */
function optionsFromEnv(): PoolOptions {
  return {
    ...DEFAULT_OPTIONS,
    maxActive: intFromEnv("TENANT_POOL_MAX_ACTIVE", DEFAULT_OPTIONS.maxActive),
    maxConnections: intFromEnv("TENANT_POOL_MAX_CONNECTIONS", DEFAULT_OPTIONS.maxConnections),
    poolSize: intFromEnv("TENANT_POOL_SIZE", DEFAULT_OPTIONS.poolSize),
  };
}

function registry(): Registry {
  return (globalRegistry.__boutiqueTenantClients ??= {
    entries: new Map(),
    waiters: [],
    options: optionsFromEnv(),
    created: 0,
    evicted: 0,
    waited: 0,
    timedOut: 0,
  });
}

export function configureTenantPool(options: Partial<PoolOptions>): void {
  Object.assign(registry().options, options);
}

/** Vuelve a los valores de fábrica (con lo que digan las variables `TENANT_POOL_*`). Para las pruebas. */
export function resetTenantPoolOptions(): void {
  registry().options = optionsFromEnv();
}

/** Cuántos negocios pueden tener cliente abierto a la vez con las opciones de ahora. */
function capacityOf(reg: Registry): number {
  const { maxActive, maxConnections, poolSize } = reg.options;
  return Math.max(1, Math.min(maxActive, Math.floor(maxConnections / poolSize)));
}

/** `readOnly`: el plan del negocio está en solo lectura (ver `read-only-guard.ts`); el resolutor corta las escrituras. */
export type TenantLease = { client: PrismaClient; release: () => void; readOnly?: boolean };

function closeEntry(entry: Entry, reg: Registry): void {
  reg.evicted += 1;
  void entry.client.$disconnect().catch(() => undefined);
}

/** Despierta a quienes esperan lugar: cada uno vuelve a mirar si ya le toca. */
function wakeWaiters(reg: Registry): void {
  const waiting = reg.waiters.splice(0);
  for (const waiter of waiting) {
    clearTimeout(waiter.timer);
    waiter.wake();
  }
}

function evictIdle(reg: Registry, now: number): void {
  let freed = false;
  for (const [id, entry] of reg.entries) {
    if (entry.inFlight === 0 && now - entry.lastUsed >= reg.options.idleMs) {
      reg.entries.delete(id);
      closeEntry(entry, reg);
      freed = true;
    }
  }
  if (freed) {
    wakeWaiters(reg);
  }
}

/** Cierra los menos usados (sin operaciones en curso) hasta dejar lugar para uno más. Devuelve si ya hay lugar. */
function makeRoom(reg: Registry): boolean {
  const capacity = capacityOf(reg);
  while (reg.entries.size >= capacity) {
    let oldest: [string, Entry] | undefined;
    for (const candidate of reg.entries) {
      if (candidate[1].inFlight === 0 && (!oldest || candidate[1].lastUsed < oldest[1].lastUsed)) {
        oldest = candidate;
      }
    }
    if (!oldest) {
      return false; // todos están ocupados: quien pide lugar espera a que se libere uno
    }
    reg.entries.delete(oldest[0]);
    closeEntry(oldest[1], reg);
  }
  return true;
}

function sleepUntilWoken(reg: Registry, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const waiter: Waiter = {
      wake: resolve,
      timer: setTimeout(() => {
        const index = reg.waiters.indexOf(waiter);
        if (index !== -1) {
          reg.waiters.splice(index, 1);
        }
        resolve();
      }, ms),
    };
    waiter.timer.unref();
    reg.waiters.push(waiter);
  });
}

function createEntry(tenant: TenantRef, reg: Registry, now: number, poolSize?: number): Entry {
  const adapter = new PrismaPg({
    connectionString: tenant.databaseUrl,
    max: poolSize ?? reg.options.poolSize,
    idleTimeoutMillis: reg.options.connectionIdleMs,
    connectionTimeoutMillis: reg.options.connectionTimeoutMs,
  });
  const entry: Entry = {
    client: new PrismaClient({ adapter }),
    databaseUrl: tenant.databaseUrl,
    lastUsed: now,
    inFlight: 0,
  };
  reg.entries.set(tenant.id, entry);
  reg.created += 1;
  return entry;
}

/**
 * Presta el cliente del negocio. Quien lo pide **debe** llamar a `release()` al terminar su operación (el resolutor de `db`
 * lo hace siempre): mientras haya operaciones en curso, el cliente no se cierra.
 */
export async function acquireTenantClient(
  tenant: TenantRef,
  poolSize?: number,
): Promise<TenantLease> {
  const reg = registry();
  if (!reg.sweeper) {
    reg.sweeper = setInterval(() => evictIdle(reg, Date.now()), SWEEP_EVERY_MS);
    reg.sweeper.unref();
  }

  let entry = reg.entries.get(tenant.id);
  if (entry && entry.databaseUrl !== tenant.databaseUrl) {
    // Cambiaron las credenciales (rotación): se reemplaza el cliente y el viejo se cierra cuando termine lo que tiene en curso.
    reg.entries.delete(tenant.id);
    const stale = entry;
    const closeWhenIdle = setInterval(() => {
      if (stale.inFlight === 0) {
        clearInterval(closeWhenIdle);
        closeEntry(stale, reg);
      }
    }, 1_000);
    closeWhenIdle.unref();
    entry = undefined;
  }

  // Sin cliente abierto: se necesita un lugar. Si todos están ocupados se espera a que se libere uno (otro que esperaba lo
  // mismo pudo haber abierto ya este negocio, por eso se vuelve a mirar en cada vuelta).
  const deadline = Date.now() + reg.options.waitMs;
  let waitedOnce = false;
  while (!entry) {
    entry = reg.entries.get(tenant.id);
    if (entry) {
      break;
    }
    if (makeRoom(reg)) {
      entry = createEntry(tenant, reg, Date.now(), poolSize);
      break;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      reg.timedOut += 1;
      logger.warn("tenant.pool_busy", {
        tenant: tenant.slug ?? tenant.id,
        active: reg.entries.size,
        capacity: capacityOf(reg),
        waitMs: reg.options.waitMs,
      });
      throw new TenantPoolBusyError();
    }
    if (!waitedOnce) {
      waitedOnce = true;
      reg.waited += 1;
    }
    await sleepUntilWoken(reg, remaining);
  }

  entry.lastUsed = Date.now();
  entry.inFlight += 1;
  const held = entry;
  let released = false;
  return {
    client: held.client,
    readOnly: tenant.entitlements?.mode === "readonly",
    release: () => {
      if (!released) {
        released = true;
        held.inFlight -= 1;
        held.lastUsed = Date.now();
        if (held.inFlight === 0 && reg.waiters.length > 0) {
          wakeWaiters(reg);
        }
      }
    },
  };
}

export function tenantPoolStats(): {
  active: number;
  /** Cuántos negocios caben abiertos a la vez con las opciones de ahora. */
  capacity: number;
  /** Negocios esperando lugar en este momento. */
  waiting: number;
  created: number;
  evicted: number;
  /** Cuántas veces un negocio tuvo que esperar lugar, y cuántas esa espera venció. */
  waited: number;
  timedOut: number;
} & PoolOptions {
  const reg = registry();
  return {
    active: reg.entries.size,
    capacity: capacityOf(reg),
    waiting: reg.waiters.length,
    created: reg.created,
    evicted: reg.evicted,
    waited: reg.waited,
    timedOut: reg.timedOut,
    ...reg.options,
  };
}

/**
 * Olvida el cliente de un negocio y cierra sus conexiones cuando termine lo que tiene en curso (al archivar su base: Postgres
 * no renombra una base con conexiones abiertas).
 */
export function evictTenantClient(id: string): void {
  const reg = registry();
  const entry = reg.entries.get(id);
  if (!entry) {
    return;
  }
  reg.entries.delete(id);
  wakeWaiters(reg);
  const closeWhenIdle = setInterval(() => {
    if (entry.inFlight === 0) {
      clearInterval(closeWhenIdle);
      closeEntry(entry, reg);
    }
  }, 200);
  closeWhenIdle.unref();
}

/** Cierra todas las conexiones de todos los negocios (apagado ordenado y pruebas). */
export async function closeAllTenantClients(): Promise<void> {
  const reg = registry();
  const entries = [...reg.entries.values()];
  reg.entries.clear();
  wakeWaiters(reg);
  await Promise.all(entries.map((entry) => entry.client.$disconnect().catch(() => undefined)));
}
