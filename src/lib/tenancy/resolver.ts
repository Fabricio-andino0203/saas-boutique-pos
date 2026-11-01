import type { PrismaClient } from "@/generated/prisma/client";
import { getTenantDirectory } from "@/lib/tenancy/control-directory";
import { normalizeHost, type DirectoryEntry } from "@/lib/tenancy/directory";
import { acquireTenantClient, type TenantLease } from "@/lib/tenancy/tenant-clients";
import {
  processDefaultTenant,
  TenantContextError,
  tenantFromContext,
  type TenantRef,
} from "@/lib/tenancy/tenant-context";

/**
 * El `db` de toda la aplicación: un objeto que **elige el cliente del negocio actual en cada llamada**.
 *
 * Los servicios no cambian: siguen escribiendo `client = db` y llamando `db.sale.create(...)`, `db.$transaction(...)` o
 * `db.$queryRaw\`...\``. Cada llamada obtiene primero el cliente del negocio de la petición, ejecuta la operación y lo suelta.
 *
 * Modos (`TENANCY_MODE`):
 * - `single` (por omisión): una sola base, la de `DATABASE_URL`. Es el comportamiento de hoy, para la instalación de un negocio.
 * - `multi`: **falla cerrado**. El negocio sale del contexto (`runWithTenant`: procesos y pruebas) o del host de la petición
 *   web; sin negocio no hay base de datos y la operación lanza `TenantContextError`. Solo fuera de una petición web puede
 *   haber un negocio predeterminado del proceso (`setProcessDefaultTenant`: pruebas y scripts de un solo negocio).
 */

function mode(): "single" | "multi" {
  return process.env.TENANCY_MODE === "multi" ? "multi" : "single";
}

/**
 * Negocio de una petición web: el host (ya normalizado) buscado en el directorio. Nunca otra cosa. `inRequest` distingue
 * "no estoy en una petición" de "estoy en una petición cuyo host no es de ningún negocio" (que debe fallar, no caer a un default).
 */
async function tenantFromRequest(): Promise<{ inRequest: boolean; entry?: DirectoryEntry }> {
  let host: string | null;
  try {
    // Import dinámico: los scripts y las pruebas no cargan Next. Fuera de una petición, `headers()` lanza.
    const { headers } = await import("next/headers");
    host = (await headers()).get("host");
  } catch {
    return { inRequest: false };
  }
  const normalized = normalizeHost(host);
  return {
    inRequest: true,
    entry: normalized ? await getTenantDirectory().lookupByHost(normalized) : undefined,
  };
}

/** Resuelve el negocio actual (o falla). Exportada para que `proxy.ts` y las pruebas usen la misma regla. */
export async function resolveCurrentTenant(): Promise<TenantRef> {
  if (mode() === "single") {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new TenantContextError("DATABASE_URL no está definida");
    }
    return { id: "single", databaseUrl };
  }
  const fromContext = tenantFromContext();
  if (fromContext) {
    return fromContext;
  }
  const request = await tenantFromRequest();
  if (request.inRequest) {
    if (request.entry?.state === "active") {
      return request.entry.tenant;
    }
    throw new TenantContextError(
      request.entry
        ? "El negocio de la petición no puede operar (cuenta suspendida)"
        : "El host de la petición no corresponde a ningún negocio",
    );
  }
  const fallback = processDefaultTenant();
  if (fallback) {
    return fallback;
  }
  throw new TenantContextError();
}

/**
 * Cómo se nombra el negocio actual en el registro y en el limitador de intentos: su subdominio (o su id). En modo `single` no
 * hay otro negocio al que distinguir y devuelve `undefined`, con lo que el registro y las claves quedan como siempre. Nunca
 * lanza: un registro que falla por no saber el negocio no debe esconder el problema original.
 */
export async function currentTenantLabel(): Promise<string | undefined> {
  if (mode() === "single") {
    return undefined;
  }
  try {
    const tenant = await resolveCurrentTenant();
    return tenant.slug ?? tenant.id;
  } catch {
    return undefined;
  }
}

async function lease(): Promise<TenantLease> {
  const tenant = await resolveCurrentTenant();
  // En modo `single` se conserva el pool de siempre (10); en `multi` cada negocio usa un pool pequeño.
  return acquireTenantClient(tenant, mode() === "single" ? 10 : undefined);
}

type Method = (...args: unknown[]) => unknown;

/**
 * Proxy en cadena: `db.user.findMany` es un proxy que, al llamarse, resuelve el negocio, busca el mismo camino en su cliente
 * real y lo invoca. No hace falta enumerar los métodos de Prisma ni mantenerlos al actualizar.
 */
export function createTenantResolver(getLease: () => Promise<TenantLease> = lease): PrismaClient {
  const build = (path: readonly string[]): unknown =>
    new Proxy(function tenantCall() {}, {
      get(_target, property) {
        // `await db` o inspecciones (`then`, símbolos) no deben tratarse como una llamada a la base.
        if (typeof property === "symbol" || property === "then") {
          return undefined;
        }
        return build([...path, property]);
      },
      apply(_target, _this, args: unknown[]) {
        if (path.length === 0) {
          throw new TypeError("`db` no se puede llamar como función");
        }
        return (async () => {
          const { client, release } = await getLease();
          try {
            const parent = path
              .slice(0, -1)
              .reduce<unknown>((object, key) => (object as Record<string, unknown>)[key], client);
            const method = (parent as Record<string, unknown>)[
              path[path.length - 1] as string
            ] as Method;
            return await method.apply(parent, args);
          } finally {
            release();
          }
        })();
      },
    });
  return build([]) as PrismaClient;
}
