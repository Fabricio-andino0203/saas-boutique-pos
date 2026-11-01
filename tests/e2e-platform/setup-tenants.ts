import "dotenv/config";

import { seedBase } from "../../prisma/seed/run-seed";
import { closeControlDb, controlDb } from "../../src/lib/tenancy/control-db";
import { dropTenantResources } from "../../src/lib/tenancy/provision-steps";
import {
  createTemplateDatabase,
  createTenantDatabase,
  dropDatabase,
  dropTenantDatabase,
  ensureDatabase,
  urlFor,
  withClient,
} from "../../src/lib/tenancy/provision-db";
import { getVault, vaultContext } from "../../src/lib/tenancy/vault";
import { createFirstOwner } from "../../src/modules/users/bootstrap";
import { E2E_PASSWORD, E2E_TEMPLATE_DB, OWNER_USERNAME, RETIRED, TENANTS } from "./constants";

/**
 * Prepara (o desmonta con `--drop`) los dos negocios de las pruebas de navegador de la plataforma: cada uno con su base, su
 * propietario y su nombre, registrados en la base central de PRUEBAS. Corre con `tsx` en otro proceso porque el cliente de
 * Prisma generado no carga dentro de Playwright.
 */
const TEMPLATE = E2E_TEMPLATE_DB;

async function main(): Promise<void> {
  const controlUrl = process.env.CONTROL_DATABASE_URL ?? "";
  const adminUrl = process.env.DATABASE_URL_TEST ?? "";
  if (!new URL(controlUrl).pathname.endsWith("_test") || !adminUrl) {
    throw new Error(
      "Estas pruebas solo usan las bases _test (CONTROL_DATABASE_URL y DATABASE_URL_TEST).",
    );
  }
  const tenants = Object.values(TENANTS);

  // Siempre se parte de cero: lo que haya quedado de una corrida anterior se quita. Eso incluye los negocios que las pruebas
  // dieron de alta desde el panel (subdominio `panel-…`): sus bases, sus roles, sus intentos de alta y su registro.
  const leftovers = await controlDb.tenant.findMany({
    where: {
      OR: [
        { slug: { in: tenants.map((tenant) => tenant.slug) } },
        { slug: { startsWith: "panel-" } },
        { slug: { in: Object.values(RETIRED).map((item) => item.slug) } },
      ],
    },
    select: { id: true, dbName: true, dbRole: true, archivedDbName: true },
  });
  for (const tenant of leftovers) {
    if (tenant.archivedDbName) {
      await dropDatabase(adminUrl, tenant.archivedDbName);
    }
    if (tenant.dbName && tenant.dbRole) {
      await dropTenantResources(adminUrl, { database: tenant.dbName, role: tenant.dbRole });
    }
  }
  await controlDb.$executeRawUnsafe(
    `TRUNCATE TABLE "TenantUsageSnapshot", "TenantBackup", "PlatformPayment", "Subscription", "Plan" CASCADE`,
  );
  await controlDb.provisioningRun.deleteMany({
    where: { tenantId: { in: leftovers.map((tenant) => tenant.id) } },
  });
  await controlDb.tenant.deleteMany({
    where: { id: { in: leftovers.map((tenant) => tenant.id) } },
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
  // Un respaldo que falló hace dos horas en el negocio B: el panel debe mostrarlo como algo que atender.
  await controlDb.tenantBackup.create({
    data: {
      scope: "TENANT",
      tenantId: TENANTS.b.id,
      database: `t_${TENANTS.b.id}`,
      trigger: "SCHEDULED",
      status: "FAILED",
      requestedAt: new Date(Date.now() - 2 * 3_600_000),
      finishedAt: new Date(Date.now() - 2 * 3_600_000),
      error: "pg_dump falló: la base no respondió",
    },
  });
  // Dos negocios dados de baja, con su base archivada en el servidor (borrado guiado desde el panel).
  for (const retired of Object.values(RETIRED)) {
    await ensureDatabase(adminUrl, retired.database);
    await controlDb.tenant.create({
      data: {
        id: retired.id,
        slug: retired.slug,
        name: `Archivada ${retired.slug}`,
        status: "DELETED",
        archivedAt: new Date(),
        archivedDbName: retired.database,
      },
    });
  }
  // La segunda ya tiene su volcado final: lo que el servicio de respaldos deja anotado cuando lo termina bien.
  await controlDb.tenantBackup.create({
    data: {
      scope: "ARCHIVED",
      tenantId: RETIRED.dumped.id,
      database: RETIRED.dumped.database,
      trigger: "FINAL",
      status: "OK",
      fileName: `final-${RETIRED.dumped.database}-20261103T020000Z.dump.enc`,
      bytes: 125_000,
      checksum: "d".repeat(64),
      verifiedAt: new Date(),
      finishedAt: new Date(),
      keepUntil: new Date(Date.now() + 365 * 86_400_000),
    },
  });
  // La plantilla se conserva: el alta desde el panel copia de ella (se quita con --drop).
  console.log(`Negocios de prueba listos: ${tenants.map((tenant) => tenant.slug).join(", ")}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closeControlDb());
