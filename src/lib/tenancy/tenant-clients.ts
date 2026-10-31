import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import type { TenantRef } from "@/lib/tenancy/tenant-context";

/**
 * Administrador de conexiones: un cliente de Prisma (con su pool pequeño) por negocio, creado al primer uso y cerrado cuando
 * lleva rato sin usarse o cuando hay demasiados abiertos. Nunca se cierra un cliente con operaciones en curso.
 */

export type PoolOptions = {
  /** Cuántos negocios con conexiones abiertas a la vez (por instancia de la app). */
  maxActive: number;
  /** Conexiones por negocio. */
  poolSize: number;
  /** Cuánto sin usarse antes de cerrar las conexiones de un negocio. */
  idleMs: number;
};

const DEFAULT_OPTIONS: PoolOptions = { maxActive: 50, poolSize: 3, idleMs: 5 * 60_000 };
const SWEEP_EVERY_MS = 60_000;

type Entry = {
  client: PrismaClient;
  databaseUrl: string;
  lastUsed: number;
  inFlight: number;
};

type Registry = {
  entries: Map<string, Entry>;
  options: PoolOptions;
  created: number;
  evicted: number;
  sweeper?: ReturnType<typeof setInterval>;
};

const globalRegistry = globalThis as typeof globalThis & { __boutiqueTenantClients?: Registry };

function registry(): Registry {
  return (globalRegistry.__boutiqueTenantClients ??= {
    entries: new Map(),
    options: { ...DEFAULT_OPTIONS },
    created: 0,
    evicted: 0,
  });
}

export function configureTenantPool(options: Partial<PoolOptions>): void {
  Object.assign(registry().options, options);
}

export type TenantLease = { client: PrismaClient; release: () => void };

function closeEntry(entry: Entry, reg: Registry): void {
  reg.evicted += 1;
  void entry.client.$disconnect().catch(() => undefined);
}

function evictIdle(reg: Registry, now: number): void {
  for (const [id, entry] of reg.entries) {
    if (entry.inFlight === 0 && now - entry.lastUsed >= reg.options.idleMs) {
      reg.entries.delete(id);
      closeEntry(entry, reg);
    }
  }
}

/** Cierra los menos usados (sin operaciones en curso) hasta dejar lugar para uno más. */
function makeRoom(reg: Registry): void {
  while (reg.entries.size >= reg.options.maxActive) {
    let oldest: [string, Entry] | undefined;
    for (const candidate of reg.entries) {
      if (candidate[1].inFlight === 0 && (!oldest || candidate[1].lastUsed < oldest[1].lastUsed)) {
        oldest = candidate;
      }
    }
    if (!oldest) {
      return; // todos están ocupados: se permite pasar el tope un momento antes que cortar una venta
    }
    reg.entries.delete(oldest[0]);
    closeEntry(oldest[1], reg);
  }
}

/**
 * Presta el cliente del negocio. Quien lo pide **debe** llamar a `release()` al terminar su operación (el resolutor de `db`
 * lo hace siempre): mientras haya operaciones en curso, el cliente no se cierra.
 */
export function acquireTenantClient(tenant: TenantRef, poolSize?: number): TenantLease {
  const reg = registry();
  const now = Date.now();
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
  if (!entry) {
    makeRoom(reg);
    const adapter = new PrismaPg({
      connectionString: tenant.databaseUrl,
      max: poolSize ?? reg.options.poolSize,
    });
    entry = {
      client: new PrismaClient({ adapter }),
      databaseUrl: tenant.databaseUrl,
      lastUsed: now,
      inFlight: 0,
    };
    reg.entries.set(tenant.id, entry);
    reg.created += 1;
  }

  entry.lastUsed = now;
  entry.inFlight += 1;
  const held = entry;
  let released = false;
  return {
    client: held.client,
    release: () => {
      if (!released) {
        released = true;
        held.inFlight -= 1;
        held.lastUsed = Date.now();
      }
    },
  };
}

export function tenantPoolStats(): {
  active: number;
  created: number;
  evicted: number;
} & PoolOptions {
  const reg = registry();
  return {
    active: reg.entries.size,
    created: reg.created,
    evicted: reg.evicted,
    ...reg.options,
  };
}

/** Cierra todas las conexiones de todos los negocios (apagado ordenado y pruebas). */
export async function closeAllTenantClients(): Promise<void> {
  const reg = registry();
  const entries = [...reg.entries.values()];
  reg.entries.clear();
  await Promise.all(entries.map((entry) => entry.client.$disconnect().catch(() => undefined)));
}
