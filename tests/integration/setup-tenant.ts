import { setProcessDefaultTenant } from "@/lib/tenancy/tenant-context";

/**
 * Las pruebas de integración existentes usan `db` por omisión en varios sitios (también en sus ganchos `afterAll`). En modo
 * `multi` (estricto, sin base por defecto) necesitan un negocio: se les da el de la base de pruebas para todo el proceso.
 * En modo `single` (el de hoy) no hace nada.
 */
if (process.env.TENANCY_MODE === "multi" && process.env.DATABASE_URL) {
  setProcessDefaultTenant({ id: "suite", databaseUrl: process.env.DATABASE_URL });
}
