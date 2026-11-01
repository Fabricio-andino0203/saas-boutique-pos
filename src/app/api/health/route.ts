import { headers } from "next/headers";
import { connection } from "next/server";

import { checkHealth, createHealthHandler } from "@/lib/health";
import { getTenantDirectory } from "@/lib/tenancy/control-directory";
import { classifyHost } from "@/lib/tenancy/host";
import { checkPlatformHealth } from "@/lib/tenancy/platform-health";

const tenantHandler = createHealthHandler(checkHealth);
const platformHandler = createHealthHandler(checkPlatformHealth);

/**
 * Estado del servicio. En modo `single` (y en la dirección de un negocio) revisa la base de ese negocio y sus migraciones.
 * En modo `multi`, una petición que no es de un negocio (la prueba de salud de Docker llama a `127.0.0.1`, el panel o un
 * monitor) recibe el estado de la plataforma: la base central y la llave maestra.
 */
export async function GET(): Promise<Response> {
  await connection();
  let isTenant: boolean;
  try {
    isTenant =
      (await classifyHost((await headers()).get("host"), {
        mode: process.env.TENANCY_MODE === "multi" ? "multi" : "single",
        platformHost: process.env.PLATFORM_HOST,
        directory: getTenantDirectory(),
      })) === "tenant";
  } catch {
    isTenant = false; // el directorio no responde: lo que se reporta es el estado de la plataforma
  }
  return isTenant ? tenantHandler() : platformHandler();
}
