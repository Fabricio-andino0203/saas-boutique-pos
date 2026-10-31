import { controlDb, type ControlDb } from "@/lib/tenancy/control-db";
import { getVault } from "@/lib/tenancy/vault";

/**
 * Estado del servicio de la plataforma: la base central responde y la llave maestra está bien configurada.
 * Devuelve solo `true` o `false`: quien consulta no necesita más (y no debe saber nombres, versiones ni conteos).
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
