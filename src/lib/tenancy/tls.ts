import { classifyHost, type HostConfig } from "@/lib/tenancy/host";

/**
 * ¿Se le puede emitir un certificado a este dominio? Es la respuesta a la pregunta `ask` del HTTPS bajo demanda de Caddy
 * (`Caddyfile.multi`): sin ella cualquiera podría apuntar un nombre cualquiera a este servidor y gastar los cupos de la
 * autoridad certificadora. Solo se emite para el panel y para negocios que existen (activos o suspendidos: un negocio
 * suspendido sigue necesitando HTTPS para mostrar su aviso).
 *
 * Solo tiene sentido en modo `multi`; en `single` el dominio es uno fijo que Caddy ya conoce.
 */
export async function isCertificateAllowed(host: string, config: HostConfig): Promise<boolean> {
  if (config.mode !== "multi") {
    return false;
  }
  return (await classifyHost(host, config)) !== "unknown";
}
