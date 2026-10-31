import type { Instrumentation } from "next";

import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

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
    timezone: env.TZ,
  });
}

/** Todo error del servidor (páginas, acciones, rutas) queda en el registro con su resumen; sin cuerpo ni cabeceras. */
export const onRequestErrorNode: Instrumentation.onRequestError = (error, request, context) => {
  logger.error("request.error", {
    error,
    method: request.method,
    // Sin la cadena de consulta: puede traer datos de búsqueda.
    path: request.path.split("?")[0],
    routePath: context.routePath,
    routeType: context.routeType,
    routerKind: context.routerKind,
  });
};
