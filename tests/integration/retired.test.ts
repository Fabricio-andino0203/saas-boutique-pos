import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { createTemplateDatabase, dropDatabase, ensureDatabase } from "@/lib/tenancy/provision-db";
import { databaseExists, dropTenantResources } from "@/lib/tenancy/provision-steps";
import { closeAllTenantClients } from "@/lib/tenancy/tenant-clients";
import { setProcessDefaultTenant } from "@/lib/tenancy/tenant-context";
import { setVault } from "@/lib/tenancy/vault";
import { archiveTenant, requestTenantDeletion } from "@/modules/platform/lifecycle";
import { startProvisioning } from "@/modules/platform/provisioning";
import { reconcileTenants } from "@/modules/platform/reconcile";
import {
  dropRetiredDatabase,
  listRetiredDatabases,
  requestFinalDump,
} from "@/modules/platform/retired";
import {
  closeControlTestDatabase,
  controlTestDb,
  resetControlDatabase,
} from "./helpers/control-db";

/**
 * Etapa 5: el borrado guiado de las bases apartadas. Nada se borra sin un volcado final comprobado; el servicio de respaldos
 * (otro contenedor) es quien hace ese volcado, así que aquí se escribe en el registro lo que él escribiría.
 */

const adminUrl = process.env.DATABASE_URL_TEST as string;
const TEMPLATE = "rt5r_template";
const config = { adminUrl, templateDb: TEMPLATE };
const context = { actor: { id: "admin-1", username: "admin-prueba" }, ip: "10.0.0.1" };
const deps = { config };

let counter = 0;
/** Da de alta un negocio real y lo archiva: queda su base `z_archived_<id>`. */
async function archivedTenant(): Promise<{ id: string; slug: string; archivedDb: string }> {
  counter += 1;
  const slug = `apartada-${counter}`;
  await startProvisioning(
    {
      slug,
      name: `Boutique apartada ${counter}`,
      ownerName: "Rosa Pérez",
      ownerUsername: "rosa",
      ownerPassword: "Temporal-2026-xyz",
    },
    context,
    { config },
  );
  await closeAllTenantClients();
  await requestTenantDeletion({ slug, reason: "Prueba de baja" }, context);
  const { archivedDatabase } = await archiveTenant({ slug, confirm: slug, early: true }, context, {
    config,
  });
  const tenant = await controlTestDb.tenant.findUniqueOrThrow({ where: { slug } });
  return { id: tenant.id, slug, archivedDb: archivedDatabase };
}

/** Lo que el servicio de respaldos deja en el registro cuando termina bien un volcado final. */
async function recordFinalDump(
  tenantId: string,
  database: string,
  overrides: Record<string, unknown> = {},
) {
  return controlTestDb.tenantBackup.create({
    data: {
      scope: "ARCHIVED",
      tenantId,
      database,
      trigger: "FINAL",
      status: "OK",
      fileName: `final-${database}-20261103T020000Z.dump.enc`,
      bytes: 125_000,
      checksum: "b".repeat(64),
      verifiedAt: new Date(),
      finishedAt: new Date(),
      keepUntil: new Date(Date.now() + 365 * 86_400_000),
      ...overrides,
    } as never,
  });
}

async function cleanUp(): Promise<void> {
  const tenants = await controlTestDb.tenant.findMany({
    select: { dbName: true, dbRole: true, archivedDbName: true },
  });
  for (const tenant of tenants) {
    if (tenant.dbName && tenant.dbRole) {
      await dropTenantResources(adminUrl, { database: tenant.dbName, role: tenant.dbRole });
    }
    if (tenant.archivedDbName) {
      await dropDatabase(adminUrl, tenant.archivedDbName);
    }
  }
}

beforeAll(async () => {
  vi.stubEnv("TENANCY_MODE", "multi");
  setProcessDefaultTenant(undefined);
  setVault(undefined);
  await resetControlDatabase();
  await createTemplateDatabase(adminUrl, TEMPLATE);
}, 240_000);

afterAll(async () => {
  await closeAllTenantClients();
  await cleanUp();
  await dropDatabase(adminUrl, TEMPLATE);
  await resetControlDatabase();
  await closeControlTestDatabase();
  vi.unstubAllEnvs();
}, 180_000);

describe("deleting an archived database for good", () => {
  it("lists it, refuses to delete it without a good final dump, and deletes it once there is one", async () => {
    const { id, slug, archivedDb } = await archivedTenant();

    const listed = (await listRetiredDatabases(deps)).find((row) => row.database === archivedDb);
    expect(listed).toMatchObject({ kind: "archived", slug, finalDump: { state: "none" } });

    // Sin volcado final no se borra nada, ni escribiendo bien el nombre.
    await expect(
      dropRetiredDatabase({ database: archivedDb, confirm: archivedDb }, context, deps),
    ).rejects.toThrow(/volcado final bueno/);
    expect(await databaseExists(adminUrl, archivedDb)).toBe(true);

    // Pedirlo deja el pedido para el servicio de respaldos, y no se puede pedir otro encima.
    const { id: requestId } = await requestFinalDump(archivedDb, context, deps);
    expect(
      await controlTestDb.tenantBackup.findUniqueOrThrow({ where: { id: requestId } }),
    ).toMatchObject({
      scope: "ARCHIVED",
      tenantId: id,
      database: archivedDb,
      trigger: "FINAL",
      status: "REQUESTED",
    });
    await expect(requestFinalDump(archivedDb, context, deps)).rejects.toBeInstanceOf(ConflictError);
    expect(
      (await listRetiredDatabases(deps)).find((row) => row.database === archivedDb)?.finalDump
        .state,
    ).toBe("open");

    // El servicio de respaldos termina: ahora sí hay una copia comprobada.
    await controlTestDb.tenantBackup.delete({ where: { id: requestId } });
    const dump = await recordFinalDump(id, archivedDb);
    expect(
      (await listRetiredDatabases(deps)).find((row) => row.database === archivedDb)?.finalDump,
    ).toMatchObject({ state: "ok", fileName: dump.fileName });

    // Escribir otro nombre no la borra; escribir el suyo, sí.
    await expect(
      dropRetiredDatabase({ database: archivedDb, confirm: "otra" }, context, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await databaseExists(adminUrl, archivedDb)).toBe(true);

    await expect(
      dropRetiredDatabase({ database: archivedDb, confirm: archivedDb }, context, deps),
    ).resolves.toEqual({ database: archivedDb, dumpFile: dump.fileName });
    expect(await databaseExists(adminUrl, archivedDb)).toBe(false);

    // El negocio queda anotado, se audita con el archivo del volcado, y la conciliación ya no la echa en falta.
    const tenant = await controlTestDb.tenant.findUniqueOrThrow({ where: { id } });
    expect(tenant.archivedDroppedAt).toBeInstanceOf(Date);
    const audit = await controlTestDb.platformAuditLog.findFirstOrThrow({
      where: { action: "ARCHIVED_DATABASE_DROPPED", tenantId: id },
    });
    expect(audit.details).toMatchObject({
      database: archivedDb,
      dumpFile: dump.fileName,
      kind: "archived",
    });
    const report = await reconcileTenants({ config });
    expect(report.missingArchives.map((item) => item.slug)).not.toContain(slug);

    // Repetirlo no hace nada raro.
    await expect(
      dropRetiredDatabase({ database: archivedDb, confirm: archivedDb }, context, deps),
    ).rejects.toBeInstanceOf(ConflictError);
  }, 180_000);

  it("does not accept a dump whose file was already removed by the retention", async () => {
    const { id, archivedDb } = await archivedTenant();
    await recordFinalDump(id, archivedDb, { prunedAt: new Date() });
    await expect(
      dropRetiredDatabase({ database: archivedDb, confirm: archivedDb }, context, deps),
    ).rejects.toThrow(/volcado final bueno/);
    expect(await databaseExists(adminUrl, archivedDb)).toBe(true);
  }, 180_000);

  it("only touches archived or replaced databases, never a live one or any other name", async () => {
    const live = await controlTestDb.tenant.create({
      data: { slug: "viva", name: "Viva", status: "PROVISIONING" },
    });
    for (const name of ["postgres", "t_algo", `t_${live.id}`, "boutique_pos_test", "z_otra_cosa"]) {
      await expect(
        dropRetiredDatabase({ database: name, confirm: name }, context, deps),
      ).rejects.toThrow();
      await expect(requestFinalDump(name, context, deps)).rejects.toThrow();
    }
    // Una archivada que no es de nadie tampoco.
    await expect(requestFinalDump("z_archived_noexiste", context, deps)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("a database a restore set aside", () => {
  it("is listed as replaced with its business and date, and follows the same two steps to be deleted", async () => {
    counter += 1;
    const tenant = await controlTestDb.tenant.create({
      data: { slug: `reemplazada-${counter}`, name: "Reemplazada", status: "PROVISIONING" },
    });
    const replaced = `z_replaced_t_${tenant.id}_20261101120000`;
    expect(await ensureDatabase(adminUrl, replaced)).toBe(true);

    const listed = (await listRetiredDatabases(deps)).find((row) => row.database === replaced);
    expect(listed).toMatchObject({
      kind: "replaced",
      slug: tenant.slug,
      finalDump: { state: "none" },
    });
    expect(listed?.since?.toISOString()).toBe("2026-11-01T12:00:00.000Z");

    // La conciliación la muestra aparte y no la cuenta como un error.
    const report = await reconcileTenants({ config });
    expect(report.replacedDatabases).toContain(replaced);
    expect(report.orphanDatabases).not.toContain(replaced);

    await expect(
      dropRetiredDatabase({ database: replaced, confirm: replaced }, context, deps),
    ).rejects.toThrow(/volcado final bueno/);
    await requestFinalDump(replaced, context, deps);
    await controlTestDb.tenantBackup.deleteMany({ where: { database: replaced } });
    await recordFinalDump(tenant.id, replaced);

    await dropRetiredDatabase({ database: replaced, confirm: replaced }, context, deps);
    expect(await databaseExists(adminUrl, replaced)).toBe(false);
    // Una base reemplazada no es una baja: el negocio no queda «con su base borrada».
    expect(
      (await controlTestDb.tenant.findUniqueOrThrow({ where: { id: tenant.id } }))
        .archivedDroppedAt,
    ).toBeNull();
  }, 120_000);
});
