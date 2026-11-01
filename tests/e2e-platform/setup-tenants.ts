import "dotenv/config";

import { seedBase } from "../../prisma/seed/run-seed";
import { closeControlDb, controlDb } from "../../src/lib/tenancy/control-db";
import {
  createTemplateDatabase,
  createTenantDatabase,
  dropDatabase,
  dropTenantDatabase,
  urlFor,
  withClient,
} from "../../src/lib/tenancy/provision-db";
import { getVault, vaultContext } from "../../src/lib/tenancy/vault";
import { createFirstOwner } from "../../src/modules/users/bootstrap";
import { E2E_PASSWORD, OWNER_USERNAME, TENANTS } from "./constants";

/**
 * Prepara (o desmonta con `--drop`) los dos negocios de las pruebas de navegador de la plataforma: cada uno con su base, su
 * propietario y su nombre, registrados en la base central de PRUEBAS. Corre con `tsx` en otro proceso porque el cliente de
 * Prisma generado no carga dentro de Playwright.
 */
const TEMPLATE = "e2e_template";

async function main(): Promise<void> {
  const controlUrl = process.env.CONTROL_DATABASE_URL ?? "";
  const adminUrl = process.env.DATABASE_URL_TEST ?? "";
  if (!new URL(controlUrl).pathname.endsWith("_test") || !adminUrl) {
    throw new Error(
      "Estas pruebas solo usan las bases _test (CONTROL_DATABASE_URL y DATABASE_URL_TEST).",
    );
  }
  const tenants = Object.values(TENANTS);

  // Siempre se parte de cero: lo que haya quedado de una corrida anterior se quita.
  await controlDb.tenant.deleteMany({
    where: { slug: { in: tenants.map((tenant) => tenant.slug) } },
  });
  for (const tenant of tenants) {
    await dropTenantDatabase(adminUrl, tenant.id);
  }
  if (process.argv.includes("--drop")) {
    await dropDatabase(adminUrl, TEMPLATE);
    return;
  }

  await createTemplateDatabase(adminUrl, TEMPLATE);
  for (const tenant of tenants) {
    const provisioned = await createTenantDatabase(adminUrl, { id: tenant.id, template: TEMPLATE });
    await withClient(urlFor(adminUrl, { database: provisioned.database }), async (client) => {
      await seedBase(client);
      await createFirstOwner(
        { name: `Dueño de ${tenant.name}`, username: OWNER_USERNAME, password: E2E_PASSWORD },
        client,
      );
      await client.businessProfile.updateMany({ data: { legalName: tenant.name } });
    });
    await controlDb.tenant.create({
      data: {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        status: "ACTIVE",
        dbServerId: "primary",
        dbName: provisioned.database,
        dbRole: provisioned.role,
        dbCredentialEnc: getVault().encrypt(
          provisioned.password,
          vaultContext.tenantDatabase(tenant.id),
        ),
      },
    });
  }
  await dropDatabase(adminUrl, TEMPLATE);
  console.log(`Negocios de prueba listos: ${tenants.map((tenant) => tenant.slug).join(", ")}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closeControlDb());
