import { normalizeHost, type TenantDirectory } from "@/lib/tenancy/directory";

/**
 * Qué atiende cada nombre de host (propuesta SaaS §3.3):
 * - `platform`: el panel del superadministrador (`admin.<dominio>`). Solo existe en modo `multi` y con `PLATFORM_HOST`.
 * - `tenant`: el sistema de un negocio que opera. En modo `single` cualquier host es "el negocio" (como siempre); en modo
 *   `multi` solo `<slug>.<dominio base>` de un negocio activo.
 * - `suspended`: un negocio que existe pero no puede operar (suspendido o pendiente de baja): pantalla de cuenta suspendida.
 * - `expired`: un negocio cuya suscripción terminó (pasó la gracia y el solo lectura): «suscripción vencida».
 * - `maintenance`: un negocio cuya última migración falló: pantalla «en mantenimiento» hasta repararlo.
 * - `unknown`: nadie. Se responde 404 antes de tocar cookies o datos.
 *
 * Por qué el panel exige el modo `multi`: cuando una acción del servidor redirige (o la página que se vuelve a dibujar tras
 * una acción redirige), Next pide la página destino **desde dentro del servidor** a `http://localhost:<puerto>` y descarta
 * el encabezado `Host` original (se comprobó: `fetch` de Node ignora un `Host` forzado). Ese host interno es "desconocido"
 * en modo `multi`, así que la respuesta es un 404 y Next hace que el navegador navegue por su cuenta, que sí conserva el
 * host. En modo `single` cualquier host sería "el negocio" y el servidor devolvería la pantalla de la tienda dentro del
 * panel. Por eso `PLATFORM_HOST` solo se admite junto con `TENANCY_MODE=multi` (también lo valida `env.ts`).
 */
export type HostKind = "platform" | "tenant" | "suspended" | "expired" | "maintenance" | "unknown";

export type HostConfig = {
  mode: "single" | "multi";
  /** `PLATFORM_HOST` tal como viene del entorno (con o sin puerto). */
  platformHost?: string | undefined;
  directory: Pick<TenantDirectory, "lookupByHost">;
};

/** Lanza `TenantDirectoryError` si el directorio no puede responder: quien llama decide cómo atenderlo (503). */
export async function classifyHost(
  rawHost: string | null | undefined,
  config: HostConfig,
): Promise<HostKind> {
  const host = normalizeHost(rawHost);
  if (config.mode === "single") {
    return "tenant";
  }
  const platform = normalizeHost(config.platformHost);
  if (platform && host === platform) {
    return "platform";
  }
  if (!host) {
    return "unknown";
  }
  const entry = await config.directory.lookupByHost(host);
  if (!entry) {
    return "unknown";
  }
  if (entry.state === "active") {
    return "tenant";
  }
  return entry.state === "suspended" && entry.reason === "billing" ? "expired" : entry.state;
}
