import { normalizeHost, type TenantDirectory } from "@/lib/tenancy/directory";

/**
 * Qué atiende cada nombre de host (propuesta SaaS §3.3):
 * - `platform`: el panel del superadministrador (`admin.<dominio>`), si hay un `PLATFORM_HOST` configurado.
 * - `tenant`: el sistema de un negocio. En modo `single` cualquier host es "el negocio" (como siempre); en modo `multi`
 *   solo los hosts que están en el directorio.
 * - `unknown`: nadie. Se responde 404 antes de tocar cookies o datos.
 */
export type HostKind = "platform" | "tenant" | "unknown";

export type HostConfig = {
  mode: "single" | "multi";
  /** `PLATFORM_HOST` tal como viene del entorno (con o sin puerto). */
  platformHost?: string | undefined;
  directory: Pick<TenantDirectory, "lookupByHost">;
};

export function classifyHost(rawHost: string | null | undefined, config: HostConfig): HostKind {
  const platform = normalizeHost(config.platformHost);
  const host = normalizeHost(rawHost);
  if (platform && host === platform) {
    return "platform";
  }
  if (config.mode === "single") {
    return "tenant";
  }
  return host && config.directory.lookupByHost(host) ? "tenant" : "unknown";
}
