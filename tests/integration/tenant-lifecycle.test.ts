import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { ConflictError, ValidationError } from "@/lib/errors";
import { createControlDirectory } from "@/lib/tenancy/control-directory";
import {
  migrateDatabase,
  createTemplateDatabase,
  dropDatabase,
  withClient,
} from "@/lib/tenancy/provision-db";
import {
  adminUrlFor,
  archiveTenantDatabase,
  databaseExists,
  dropTenantResources,
  latestMigrationName,
  roleExists,
} from "@/lib/tenancy/provision-steps";
import { closeAllTenantClients } from "@/lib/tenancy/tenant-clients";
import { runWithTenant, setProcessDefaultTenant } from "@/lib/tenancy/tenant-context";
import { setVault } from "@/lib/tenancy/vault";
import { login } from "@/modules/auth/service";
import { migrateFleet } from "@/modules/platform/fleet";
import {
  archiveTenant,
  cancelTenantDeletion,
  DEFAULT_RETENTION_DAYS,
  requestTenantDeletion,
} from "@/modules/platform/lifecycle";
import { startProvisioning } from "@/modules/platform/provisioning";
import { reconcileTenants } from "@/modules/platform/reconcile";
import {
  closeControlTestDatabase,
  controlTestDb,
  resetControlDatabase,
} from "./helpers/control-db";

/**
 * Etapa 3: la flota (migrar con un negocio fallando), la baja controlada (pedir, cancelar, archivar) y la conciliación.
 * Trabaja con tres negocios reales dados de alta desde la plantilla.
 */

const adminUrl = process.env.DATABASE_URL_TEST as string;
const TEMPLATE = "rt3f_template";
const config = { adminUrl, templateDb: TEMPLATE };
const context = { actor: { id: "admin-1", username: "admin-prueba" }, ip: "10.0.0.1" };
const OWNER_PASSWORD = "Temporal-2026-xyz";
const DAY = 24 * 60 * 60 * 1000;
const directory = createControlDirectory({ baseDomain: "localhost", ttlMs: 0 });
const slugs = { a: "flota-a", b: "flota-b", c: "flota-c" } as const;

const row = (slug: string) => controlTestDb.tenant.findUniqueOrThrow({ where: { slug } });

/** Una migración que dejó de aplicarse a medias en la base de un negocio: `prisma migrate deploy` se niega a seguir (P3009). */
async function breakMigrations(database: string): Promise<void> {
  await withClient(adminUrlFor(adminUrl, database), (client) =>
    client.$executeRawUnsafe(
      `INSERT INTO "_prisma_migrations" ("id", "checksum", "migration_name", "started_at", "applied_steps_count")
       VALUES ('roto-1', 'x', '20990101000000_migracion_rota', now(), 0)`,
    ),
  );
}

async function repairMigrations(database: string): Promise<void> {
  await withClient(adminUrlFor(adminUrl, database), (client) =>
    client.$executeRawUnsafe(`DELETE FROM "_prisma_migrations" WHERE "id" = 'roto-1'`),
  );
}

/** La base del negocio queda «atrasada»: la última migración figura con otro nombre, como si faltara aplicarla. */
async function makeBehind(database: string): Promise<void> {
  const latest = latestMigrationName();
  await withClient(adminUrlFor(adminUrl, database), (client) =>
    client.$executeRawUnsafe(
      `UPDATE "_prisma_migrations" SET "migration_name" = '${latest}_old' WHERE "migration_name" = '${latest}'`,
    ),
  );
}

/** Lo que haría una migración que sí funciona: la base vuelve a estar al día. */
async function catchUp(databaseUrl: string): Promise<void> {
  const latest = latestMigrationName();
  await withClient(databaseUrl, (client) =>
    client.$executeRawUnsafe(
      `UPDATE "_prisma_migrations" SET "migration_name" = '${latest}' WHERE "migration_name" = '${latest}_old'`,
    ),
  );
}

/** Deja anotada una versión vieja, como si el sistema acabara de actualizarse y nadie hubiera migrado todavía. */
const markOutdated = (slug: string) =>
  controlTestDb.tenant.update({
    where: { slug },
    data: { schemaVersion: "20200101000000_version_vieja" },
  });

async function cleanUp(): Promise<void> {
  const tenants = await controlTestDb.tenant.findMany({
    select: { dbName: true, dbRole: true, archivedDbName: true },
  });
  for (const tenant of tenants) {
    if (tenant.dbName && tenant.dbRole) {
      await dropTenantResources(adminUrl, { database: tenant.dbName, role: tenant.dbRole });
    }
    if (tenant.archivedDbName) {
      await withClient(adminUrlFor(adminUrl, "postgres"), (client) =>
        client.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${tenant.archivedDbName}" WITH (FORCE)`),
      );
    }
  }
}

beforeAll(async () => {
  vi.stubEnv("TENANCY_MODE", "multi");
  setProcessDefaultTenant(undefined);
  setVault(undefined);
  await resetControlDatabase();
  await createTemplateDatabase(adminUrl, TEMPLATE);
  for (const [key, slug] of Object.entries(slugs)) {
    const outcome = await startProvisioning(
      {
        slug,
        name: `Flota ${key.toUpperCase()}`,
        ownerName: "Dueña",
        ownerUsername: "duena",
        ownerPassword: OWNER_PASSWORD,
      },
      context,
      { config },
    );
    expect(outcome.status).toBe("SUCCEEDED");
  }
}, 300_000);

afterAll(async () => {
  await closeAllTenantClients();
  await cleanUp();
  await dropDatabase(adminUrl, TEMPLATE);
  await resetControlDatabase();
  await closeControlTestDatabase();
  vi.unstubAllEnvs();
}, 180_000);

describe("migrating the fleet", () => {
  it("skips businesses that are already up to date without starting any migration", async () => {
    const migrate = vi.fn(migrateDatabase);
    const report = await migrateFleet({}, context, { config, migrate });
    expect(report).toMatchObject({ migrated: 0, failed: 0, blocked: 0, skipped: 3 });
    expect(migrate).not.toHaveBeenCalled();
    expect(report.latest).toBe(latestMigrationName());
  });

  it("migrates the outdated ones, with limited concurrency, and records the new version", async () => {
    for (const slug of Object.values(slugs)) {
      await markOutdated(slug);
      await makeBehind((await row(slug)).dbName!);
    }
    let running = 0;
    let peak = 0;
    // La migración real se prueba en los casos de abajo (con `force`); aquí se mide la concurrencia con una que tarda.
    const migrate = vi.fn(async (url: string) => {
      running += 1;
      peak = Math.max(peak, running);
      try {
        await new Promise((resolve) => setTimeout(resolve, 300));
        await catchUp(url);
      } finally {
        running -= 1;
      }
    });
    const report = await migrateFleet({ concurrency: 2 }, context, { config, migrate });
    expect(report).toMatchObject({ migrated: 3, failed: 0, skipped: 0 });
    expect(migrate).toHaveBeenCalledTimes(3);
    expect(peak).toBeLessThanOrEqual(2);
    for (const slug of Object.values(slugs)) {
      expect((await row(slug)).schemaVersion).toBe(latestMigrationName());
    }
    const audit = await controlTestDb.platformAuditLog.findFirstOrThrow({
      where: { action: "FLEET_MIGRATED" },
    });
    expect(audit.details).toMatchObject({ migrated: 3, failed: [] });
  }, 180_000);

  it("a business whose migration fails goes into maintenance; the others keep working and are migrated", async () => {
    const b = await row(slugs.b);
    await breakMigrations(b.dbName!);
    for (const slug of Object.values(slugs)) {
      await markOutdated(slug);
    }

    const report = await migrateFleet({ force: true }, context, { config });
    expect(report).toMatchObject({ migrated: 2, failed: 1 });
    const failed = report.entries.find((entry) => entry.result === "failed");
    expect(failed?.slug).toBe(slugs.b);
    expect(failed?.error).toBeTruthy();

    const after = await row(slugs.b);
    expect(after).toMatchObject({ status: "MIGRATION_FAILED" });
    expect(after.migrationError).toBeTruthy();
    expect(after.migrationFailedAt).toBeInstanceOf(Date);
    expect(after.schemaVersion).toBe("20200101000000_version_vieja"); // no avanzó
    // Los demás pasaron y siguen activos.
    for (const slug of [slugs.a, slugs.c]) {
      expect(await row(slug)).toMatchObject({ status: "ACTIVE", migrationError: null });
    }

    // Quien entra a su dirección ve «en mantenimiento»; sus vecinos no se enteran.
    expect((await directory.lookupByHost(`${slugs.b}.localhost`))?.state).toBe("maintenance");
    expect((await directory.lookupByHost(`${slugs.a}.localhost`))?.state).toBe("active");
    const audit = await controlTestDb.platformAuditLog.findFirstOrThrow({
      where: { action: "TENANT_MIGRATION_FAILED", tenantId: b.id },
    });
    expect(audit.details).toMatchObject({ slug: slugs.b });

    // Se repara y la siguiente migración lo devuelve a la operación.
    await repairMigrations(b.dbName!);
    const retry = await migrateFleet({}, context, { config });
    expect(retry).toMatchObject({ migrated: 1, failed: 0 });
    expect(await row(slugs.b)).toMatchObject({
      status: "ACTIVE",
      migrationError: null,
      migrationFailedAt: null,
      schemaVersion: latestMigrationName(),
    });
    expect((await directory.lookupByHost(`${slugs.b}.localhost`))?.state).toBe("active");
  }, 240_000);

  it("a failing canary stops the rest of the fleet from being touched", async () => {
    const a = await row(slugs.a);
    await controlTestDb.tenant.update({ where: { slug: slugs.a }, data: { canary: true } });
    await breakMigrations(a.dbName!);
    await markOutdated(slugs.a);
    await markOutdated(slugs.b);
    await markOutdated(slugs.c);

    const migrate = vi.fn(migrateDatabase);
    const report = await migrateFleet({ force: true }, context, { config, migrate });
    expect(report.entries.find((entry) => entry.slug === slugs.a)?.result).toBe("failed");
    expect(
      report.entries.filter((entry) => entry.result === "blocked").map((entry) => entry.slug),
    ).toEqual([slugs.b, slugs.c]);
    expect(migrate).toHaveBeenCalledTimes(1); // solo el canario
    expect((await row(slugs.b)).schemaVersion).toBe("20200101000000_version_vieja");

    await repairMigrations(a.dbName!);
    await controlTestDb.tenant.update({ where: { slug: slugs.a }, data: { canary: false } });
    const done = await migrateFleet({}, context, { config });
    expect(done).toMatchObject({ failed: 0 });
    for (const slug of Object.values(slugs)) {
      expect(await row(slug)).toMatchObject({
        status: "ACTIVE",
        schemaVersion: latestMigrationName(),
      });
    }
  }, 240_000);

  it("a suspended business that fails keeps its status (it was not serving anyway) but records the error", async () => {
    const c = await row(slugs.c);
    await controlTestDb.tenant.update({ where: { slug: slugs.c }, data: { status: "SUSPENDED" } });
    await breakMigrations(c.dbName!);
    const report = await migrateFleet({ force: true, only: [slugs.c] }, context, { config });
    expect(report).toMatchObject({ failed: 1 });
    expect(await row(slugs.c)).toMatchObject({ status: "SUSPENDED" });
    expect((await row(slugs.c)).migrationError).toBeTruthy();
    await repairMigrations(c.dbName!);
    await migrateFleet({ force: true, only: [slugs.c] }, context, { config });
    await controlTestDb.tenant.update({ where: { slug: slugs.c }, data: { status: "ACTIVE" } });
    expect((await row(slugs.c)).migrationError).toBeNull();
  }, 240_000);
});

describe("controlled removal", () => {
  it("requesting the removal takes the business offline but keeps everything; cancelling brings it back as it was", async () => {
    const before = await row(slugs.a);
    const { deleteAfter } = await requestTenantDeletion(
      { slug: slugs.a, reason: "Cerró el negocio" },
      context,
    );
    expect(deleteAfter.getTime() - Date.now()).toBeGreaterThan((DEFAULT_RETENTION_DAYS - 1) * DAY);
    const pending = await row(slugs.a);
    expect(pending).toMatchObject({
      status: "PENDING_DELETION",
      statusBeforeDeletion: "ACTIVE",
      deletionReason: "Cerró el negocio",
      dbName: before.dbName,
    });
    expect((await directory.lookupByHost(`${slugs.a}.localhost`))?.state).toBe("suspended");
    expect(await databaseExists(adminUrl, before.dbName!)).toBe(true);

    await expect(
      requestTenantDeletion({ slug: slugs.a, reason: "otra vez" }, context),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      requestTenantDeletion({ slug: slugs.b, reason: "x" }, context),
    ).rejects.toBeInstanceOf(ValidationError);

    await cancelTenantDeletion(slugs.a, context);
    expect(await row(slugs.a)).toMatchObject({
      status: "ACTIVE",
      statusBeforeDeletion: null,
      deleteAfter: null,
      deletionReason: null,
    });
    expect((await directory.lookupByHost(`${slugs.a}.localhost`))?.state).toBe("active");
    await expect(cancelTenantDeletion(slugs.a, context)).rejects.toBeInstanceOf(ConflictError);
  });

  it("does not archive before the retention ends, nor without writing the subdomain, nor an active business", async () => {
    await requestTenantDeletion({ slug: slugs.c, reason: "Dejó de pagar" }, context);
    await expect(
      archiveTenant({ slug: slugs.c, confirm: slugs.c }, context, { config }),
    ).rejects.toThrow(/retención termina/);
    await expect(
      archiveTenant({ slug: slugs.c, confirm: "otro" }, context, { config }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      archiveTenant({ slug: slugs.b, confirm: slugs.b }, context, { config }),
    ).rejects.toBeInstanceOf(ConflictError);
    await cancelTenantDeletion(slugs.c, context);
  });

  it("archives after the retention: the database is renamed (not destroyed), the role is gone and the business is DELETED", async () => {
    const before = await row(slugs.c);
    await requestTenantDeletion({ slug: slugs.c, reason: "Dejó de pagar" }, context);
    // Pasada la retención.
    const later = new Date(Date.now() + (DEFAULT_RETENTION_DAYS + 1) * DAY);
    const { archivedDatabase } = await archiveTenant({ slug: slugs.c, confirm: slugs.c }, context, {
      config,
      now: () => later,
    });
    expect(archivedDatabase).toBe(`z_archived_${before.id}`);

    const archived = await row(slugs.c);
    expect(archived).toMatchObject({
      status: "DELETED",
      archivedDbName: archivedDatabase,
      dbName: null,
      dbRole: null,
      dbCredentialEnc: null,
    });
    expect(archived.archivedAt).toBeInstanceOf(Date);
    expect(await databaseExists(adminUrl, before.dbName!)).toBe(false);
    expect(await roleExists(adminUrl, before.dbRole!)).toBe(false);
    // Los datos siguen ahí, intactos, en la base archivada.
    expect(await databaseExists(adminUrl, archivedDatabase)).toBe(true);
    await withClient(adminUrlFor(adminUrl, archivedDatabase), async (client) => {
      expect(await client.user.count({ where: { username: "duena" } })).toBe(1);
      expect((await client.businessProfile.findFirstOrThrow()).legalName).toBe("Flota C");
    });
    // Su dirección ya no atiende a nadie, y las otras siguen.
    expect(await directory.lookupByHost(`${slugs.c}.localhost`)).toBeUndefined();
    expect((await directory.lookupByHost(`${slugs.b}.localhost`))?.state).toBe("active");
    const audit = await controlTestDb.platformAuditLog.findFirstOrThrow({
      where: { action: "TENANT_ARCHIVED", tenantId: before.id },
    });
    expect(audit.details).toMatchObject({ slug: slugs.c, archivedDatabase, early: false });
    // El rol de otro negocio sigue funcionando después de eliminar el de este.
    const entry = await directory.lookupByHost(`${slugs.b}.localhost`);
    const session = await runWithTenant(
      (entry as { state: "active"; tenant: { id: string; databaseUrl: string } }).tenant,
      () => login({ username: "duena", password: OWNER_PASSWORD, ip: "10.0.0.5" }),
    );
    expect(session.token).toBeTruthy();
  }, 120_000);

  it("can archive early only when explicitly asked, and repeating an interrupted archive finishes it", async () => {
    const before = await row(slugs.b);
    await requestTenantDeletion({ slug: slugs.b, reason: "Prueba de archivo anticipado" }, context);
    await expect(
      archiveTenant({ slug: slugs.b, confirm: slugs.b }, context, { config }),
    ).rejects.toThrow(/retención termina/);
    // Se interrumpe «después de renombrar y quitar el rol»: la base ya no existe con su nombre pero el registro no se actualizó.
    await archiveTenantDatabase(adminUrl, {
      database: before.dbName!,
      role: before.dbRole!,
      archivedName: `z_archived_${before.id}`,
    });
    expect(await databaseExists(adminUrl, before.dbName!)).toBe(false);
    expect((await row(slugs.b)).status).toBe("PENDING_DELETION");
    const { archivedDatabase } = await archiveTenant(
      { slug: slugs.b, confirm: slugs.b, early: true },
      context,
      { config },
    );
    expect(archivedDatabase).toBe(`z_archived_${before.id}`);
    expect(await row(slugs.b)).toMatchObject({ status: "DELETED", dbName: null });
    const audit = await controlTestDb.platformAuditLog.findFirstOrThrow({
      where: { action: "TENANT_ARCHIVED", tenantId: before.id },
    });
    expect(audit.details).toMatchObject({ early: true });
  }, 120_000);
});

describe("reconciling the server with the registry", () => {
  it("finds nothing wrong when what is registered is what exists", async () => {
    // El estado de las pruebas anteriores deja un negocio activo (a) y dos archivados (b, c).
    const report = await reconcileTenants({ config });
    // El servidor de pruebas puede tener bases de otras pruebas: solo se mira lo que pertenece a estos negocios.
    const ours = (await controlTestDb.tenant.findMany()).flatMap((tenant) => [
      `t_${tenant.id}`,
      `z_archived_${tenant.id}`,
    ]);
    expect(report.orphanDatabases.filter((name) => ours.includes(name))).toEqual([]);
    expect(report.orphanRoles.filter((name) => ours.includes(name))).toEqual([]);
    expect(report.missingDatabases).toEqual([]);
    expect(report.missingArchives).toEqual([]);
    expect(report.staleRuns).toEqual([]);
  });

  it("reports a database and a role nobody claims, a missing database, a missing archive and an abandoned recipe", async () => {
    // 1. Una base y un rol del servidor sin negocio (p. ej. un alta que se borró del registro a mano).
    await withClient(adminUrlFor(adminUrl, "postgres"), async (client) => {
      await client.$executeRawUnsafe(`CREATE DATABASE "t_huerfana"`);
      await client.$executeRawUnsafe(
        `CREATE ROLE "t_huerfano" LOGIN PASSWORD 'abcdefghijklmnop123'`,
      );
    });
    // 2. Un negocio activo cuya base desapareció.
    const a = await row(slugs.a);
    await withClient(adminUrlFor(adminUrl, "postgres"), (client) =>
      client.$executeRawUnsafe(`ALTER DATABASE "${a.dbName}" RENAME TO "t_perdida_a_proposito"`),
    );
    // 3. Una base archivada que ya no está.
    const b = await row(slugs.b);
    await withClient(adminUrlFor(adminUrl, "postgres"), (client) =>
      client.$executeRawUnsafe(`DROP DATABASE "${b.archivedDbName}" WITH (FORCE)`),
    );
    // 4. Un alta «en marcha» que nadie atiende.
    const run = await controlTestDb.provisioningRun.findFirstOrThrow({ where: { tenantId: a.id } });
    await controlTestDb.provisioningRun.update({
      where: { id: run.id },
      data: { status: "RUNNING", heartbeatAt: new Date(Date.now() - 10 * 60_000) },
    });

    try {
      const report = await reconcileTenants({ config });
      expect(report.ok).toBe(false);
      expect(report.orphanDatabases).toContain("t_huerfana");
      expect(report.orphanDatabases).toContain("t_perdida_a_proposito");
      expect(report.orphanRoles).toContain("t_huerfano");
      expect(report.missingDatabases).toEqual([{ slug: slugs.a, database: a.dbName }]);
      expect(report.missingArchives).toEqual([{ slug: slugs.b, database: b.archivedDbName }]);
      expect(report.staleRuns.map((stale) => stale.slug)).toEqual([slugs.a]);
    } finally {
      await withClient(adminUrlFor(adminUrl, "postgres"), async (client) => {
        await client.$executeRawUnsafe(`DROP DATABASE IF EXISTS "t_huerfana" WITH (FORCE)`);
        await client.$executeRawUnsafe(`DROP ROLE IF EXISTS "t_huerfano"`);
        await client.$executeRawUnsafe(
          `ALTER DATABASE "t_perdida_a_proposito" RENAME TO "${a.dbName}"`,
        );
      });
      await controlTestDb.provisioningRun.update({
        where: { id: run.id },
        data: { status: "SUCCEEDED" },
      });
    }
  }, 120_000);

  it("reports a business that is behind the latest version", async () => {
    await markOutdated(slugs.a);
    const report = await reconcileTenants({ config });
    expect(report.behind).toEqual([
      {
        slug: slugs.a,
        schemaVersion: "20200101000000_version_vieja",
        latest: latestMigrationName(),
      },
    ]);
    // Una migración real (`prisma migrate deploy`) sobre una base que ya está al día: termina bien y anota la versión.
    const report2 = await migrateFleet({ only: [slugs.a], force: true }, context, { config });
    expect(report2).toMatchObject({ migrated: 1, failed: 0 });
    expect((await reconcileTenants({ config })).behind).toEqual([]);
  }, 120_000);
});
