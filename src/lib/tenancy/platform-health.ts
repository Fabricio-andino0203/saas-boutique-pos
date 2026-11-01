import { controlDb, type ControlDb } from "@/lib/tenancy/control-db";
import { getVault } from "@/lib/tenancy/vault";

/**
 * Estado del servicio de la plataforma: la base central responde y la llave maestra está bien configurada.
 * Devuelve solo `true` o `false`: quien consulta no necesita más (y no debe saber nombres, versiones ni conteos).
 *
 * Es lo que contesta `/api/health` cuando la petición no es de un negocio (p. ej. la prueba de salud de Docker, que llama a
 * `127.0.0.1`): ahí no hay una base de negocio que revisar, pero sí una plataforma que debe estar en pie. La salud de cada
 * negocio se pide por su propia dirección.
 */
export async function checkPlatformHealth(client: ControlDb = controlDb): Promise<boolean> {
  try {
    await client.$queryRaw`SELECT 1`;
    getVault();
    return true;
  } catch {
    return false;
  }
}
