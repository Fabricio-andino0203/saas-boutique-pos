import { connection } from "next/server";

import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getTenantDirectory } from "@/lib/tenancy/control-directory";
import { normalizeHost } from "@/lib/tenancy/directory";
import { isCertificateAllowed } from "@/lib/tenancy/tls";

const NOT_ALLOWED = () => new Response(null, { status: 404 });

/**
 * Pregunta `ask` del HTTPS bajo demanda de Caddy: `GET /api/internal/tls-allowed?domain=<host>`. Responde 200 si se puede
 * emitir un certificado para ese dominio y 404 si no.
 *
 * Solo la hace Caddy, directo por la red interna de Docker (la app no se publica). Hacia afuera no existe: el
 * `Caddyfile.multi` responde 404 a todo `/api/internal/*`. No se intenta distinguir a Caddy por sus cabeceras (Next mismo añade
 * `X-Forwarded-For` a todo lo que recibe, así que no sirve de señal). Lo único que revela es si un nombre es de un negocio,
 * dato que de todos modos es público en cuanto se emite su certificado.
 */
export async function GET(request: Request): Promise<Response> {
  await connection();
  // Donde no hay Caddy (Railway) esta ruta quedaría abierta a internet: se apaga y responde como si no existiera.
  if (env.TLS_ASK === "off") {
    return NOT_ALLOWED();
  }
  const domain = normalizeHost(new URL(request.url).searchParams.get("domain"));
  if (!domain) {
    return NOT_ALLOWED();
  }
  try {
    const allowed = await isCertificateAllowed(domain, {
      mode: process.env.TENANCY_MODE === "multi" ? "multi" : "single",
      platformHost: process.env.PLATFORM_HOST,
      directory: getTenantDirectory(),
    });
    return allowed ? new Response("ok", { status: 200 }) : NOT_ALLOWED();
  } catch (error) {
    logger.error("tls.ask_failed", { domain, error });
    return new Response(null, { status: 503 });
  }
}
