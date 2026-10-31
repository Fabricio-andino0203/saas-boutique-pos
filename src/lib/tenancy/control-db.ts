import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/control/client";

/**
 * Acceso a la base CENTRAL (plano de control): negocios, superadministradores y su auditoría. Es una base distinta de la de
 * cada negocio y nunca guarda ventas, inventario ni clientes.
 *
 * Solo `src/modules/platform/` y `src/lib/` pueden importarlo (lo vigila una prueba de arquitectura): el código de un
 * negocio jamás debe poder tocar la base de la plataforma.
 */

export type ControlDb = PrismaClient;

const POOL_SIZE = 5;

const globalControl = globalThis as typeof globalThis & { __boutiqueControlDb?: ControlDb };

export function getControlDb(): ControlDb {
  const connectionString = process.env.CONTROL_DATABASE_URL;
  if (!connectionString) {
    throw new Error("Falta CONTROL_DATABASE_URL: la plataforma no tiene base central configurada");
  }
  return (globalControl.__boutiqueControlDb ??= new PrismaClient({
    adapter: new PrismaPg({ connectionString, max: POOL_SIZE }),
  }));
}

/**
 * Cliente perezoso: importar este módulo no abre ninguna conexión ni exige la variable de entorno; se resuelve al primer uso.
 * Así los `service` pueden declarar `client = controlDb` por omisión, igual que los de un negocio con `db`.
 */
export const controlDb: ControlDb = new Proxy({} as ControlDb, {
  get(_target, property) {
    if (property === "then" || typeof property === "symbol") {
      return undefined; // que `await controlDb` no lo trate como una promesa
    }
    const client = getControlDb();
    const value: unknown = Reflect.get(client, property, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

export async function closeControlDb(): Promise<void> {
  const client = globalControl.__boutiqueControlDb;
  globalControl.__boutiqueControlDb = undefined;
  await client?.$disconnect();
}
