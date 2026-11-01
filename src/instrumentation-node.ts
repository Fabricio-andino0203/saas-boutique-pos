import type { Instrumentation } from "next";

import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getTenantDirectory } from "@/lib/tenancy/control-directory";

/**
 * Parte de la instrumentación que solo corre en Node. Vive aparte de `instrumentation.ts` porque Next analiza ese archivo
 * también para el entorno "edge", donde `process.version` y la salida estándar no existen.
 *
 * Importar `env` aquí hace que una configuración inválida (p. ej. `APP_URL` sin https con `DEPLOYMENT=production`) detenga
 * el arranque de inmediato, en vez de fallar en la primera venta.
 */
export function registerNode(): void {
  logger.info("server.start", {
    version: process.env.APP_VERSION ?? "dev",
    node: process.version,
    deployment: env.DEPLOYMENT,
    tenancy: env.TENANCY_MODE,
    timezone: env.TZ,
  });
}

/** Multi-negocio: de qué negocio es la petición, por su host (solo se busca en el directorio; nunca lanza). */
async function tenantOf(
  headers: Record<string, string | string[] | undefined>,
): Promise<string | undefined> {
  if (process.env.TENANCY_MODE !== "multi") {
    return undefined;
  }
  const raw = headers.host;
  const host = Array.isArray(raw) ? raw[0] : raw;
  try {
    return host ? (await getTenantDirectory().lookupByHost(host))?.tenant.slug : undefined;
  } catch {
    return undefined;
  }
}

/** Todo error del servidor (páginas, acciones, rutas) queda en el registro con su resumen; sin cuerpo ni cabeceras. */
export const onRequestErrorNode: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  logger.error("request.error", {
    tenant: await tenantOf(request.headers),
    error,
    method: request.method,
    // Sin la cadena de consulta: puede traer datos de búsqueda.
    path: request.path.split("?")[0],
    routePath: context.routePath,
    routeType: context.routeType,
    routerKind: context.routerKind,
  });
};
