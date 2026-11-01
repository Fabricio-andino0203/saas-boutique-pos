import "dotenv/config";

import { closeControlDb, controlDb } from "../../../src/lib/tenancy/control-db";
import { adoptExistingStore } from "../../../src/modules/platform/tenants";

/**
 * Prepara las pruebas E2E de la tienda en modo multi-negocio (E2E_TENANCY=multi): registra la base de las pruebas
 * (`DATABASE_URL`) como el negocio #1, `tienda`, en la base central de PRUEBAS. Corre con `tsx` en otro proceso porque el
 * cliente de Prisma generado no carga dentro de Playwright.
 */
async function main(): Promise<void> {
  const controlUrl = process.env.CONTROL_DATABASE_URL ?? "";
  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (!new URL(controlUrl).pathname.endsWith("_test")) {
    throw new Error("Estas pruebas solo usan una base central _test (CONTROL_DATABASE_URL).");
  }
  // Una corrida anterior pudo dejar el registro: se parte de cero (la base central de pruebas es desechable).
  await controlDb.$executeRawUnsafe(
    'TRUNCATE TABLE "TenantUsageSnapshot", "TenantBackup", "PlatformPayment", "Subscription", "ProvisioningRun", "Tenant"',
  );
  const tenant = await adoptExistingStore(
    { slug: "tienda", name: "Tienda E2E", databaseUrl },
    { actor: null },
  );
  console.log(`Tienda E2E registrada como "${tenant.slug}" (datos ${tenant.schemaVersion}).`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closeControlDb());
