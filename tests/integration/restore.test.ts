import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { ConflictError, NotFoundError } from "@/lib/errors";
import { createControlDirectory } from "@/lib/tenancy/control-directory";
import {
  createTemplateDatabase,
  dropDatabase,
  urlFor,
  withClient,
} from "@/lib/tenancy/provision-db";
import {
  adminUrlFor,
  databaseExists,
  dropTenantResources,
  readSchemaVersion,
  roleExists,
} from "@/lib/tenancy/provision-steps";
import { closeAllTenantClients } from "@/lib/tenancy/tenant-clients";
import { runWithTenant, setProcessDefaultTenant } from "@/lib/tenancy/tenant-context";
import { setVault } from "@/lib/tenancy/vault";
import { login } from "@/modules/auth/service";
import { startProvisioning } from "@/modules/platform/provisioning";
import { relinkTenant } from "@/modules/platform/restore";
import {
  closeControlTestDatabase,
  controlTestDb,
  resetControlDatabase,
} from "./helpers/control-db";

/**
 * Etapa 5: terminar la restauración de un negocio. Un volcado devuelve los datos pero no el rol, los permisos ni la versión del
 * sistema que corresponden al servidor donde se restaura. Aquí se simula lo que deja una restauración en un servidor nuevo (la
 * base está, el rol del negocio no) y se comprueba que `relinkTenant` lo deja funcionando sin tocar a otro negocio.
 */

const adminUrl = process.env.DATABASE_URL_TEST as string;
const TEMPLATE = "rt5_template";
const config = { adminUrl, templateDb: TEMPLATE };
const OWNER_PASSWORD = "Temporal-2026-xyz";
const context = { actor: { id: "admin-1", username: "admin-prueba" }, ip: "10.0.0.1" };
const directory = createControlDirectory({ baseDomain: "localhost", ttlMs: 0 });

let counter = 0;
async function provision(): Promise<{ slug: string; database: string; role: string; id: string }> {
  counter += 1;
  const slug = `restaurada-${counter}`;
  const outcome = await startProvisioning(
    {
      slug,
      name: `Boutique restaurada ${counter}`,
      ownerName: "Rosa Pérez",
      ownerUsername: "rosa",
      ownerPassword: OWNER_PASSWORD,
    },
    context,
    { config },
  );
  expect(outcome.status).toBe("SUCCEEDED");
  const tenant = await controlTestDb.tenant.findUniqueOrThrow({ where: { slug } });
  return { slug, id: tenant.id, database: tenant.dbName!, role: tenant.dbRole! };
}

/** Lo que deja una restauración en un servidor sin los roles: la base está, el rol del negocio no. */
async function loseServerSideState(database: string, role: string): Promise<void> {
  await withClient(adminUrlFor(adminUrl, database), (client) =>
    client.$executeRawUnsafe(`DROP OWNED BY "${role}"`),
  );
  await withClient(urlFor(adminUrl, { database: "postgres" }), async (admin) => {
    await admin.$executeRawUnsafe(`REVOKE CONNECT ON DATABASE "${database}" FROM "${role}"`);
    await admin.$executeRawUnsafe(`DROP ROLE "${role}"`);
  });
}

async function cleanUp(): Promise<void> {
  const tenants = await controlTestDb.tenant.findMany({ select: { dbName: true, dbRole: true } });
  for (const tenant of tenants) {
    if (tenant.dbName && tenant.dbRole) {
      await dropTenantResources(adminUrl, { database: tenant.dbName, role: tenant.dbRole });
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

describe("finishing the restore of a business", () => {
  it("brings back the role and its permissions on a server that lost them, and the business can sign in again", async () => {
    const tenant = await provision();
    await closeAllTenantClients();
    await loseServerSideState(tenant.database, tenant.role);
    expect(await roleExists(adminUrl, tenant.role)).toBe(false);

    const report = await relinkTenant(tenant.slug, context, { config });
    expect(report).toMatchObject({
      slug: tenant.slug,
      database: tenant.database,
      roleManaged: true,
      usersVisible: 1,
    });
    expect(await roleExists(adminUrl, tenant.role)).toBe(true);

    // La aplicación lo atiende de nuevo por su subdominio y la dueña entra con su contraseña.
    const entry = await directory.lookupByHost(`${tenant.slug}.localhost`);
    expect(entry?.state).toBe("active");
    const session = await runWithTenant(
      (entry as { state: "active"; tenant: { id: string; databaseUrl: string } }).tenant,
      () => login({ username: "rosa", password: OWNER_PASSWORD, ip: "10.0.0.2" }),
    );
    expect(session.token).toBeTruthy();

    const audit = await controlTestDb.platformAuditLog.findFirstOrThrow({
      where: { action: "TENANT_RELINKED", tenantId: tenant.id },
    });
    expect(audit.details).toMatchObject({ slug: tenant.slug, roleManaged: true, usersVisible: 1 });
    expect(JSON.stringify(audit)).not.toMatch(/password|secret/i);
  }, 120_000);

  it("is safe to repeat and leaves the business status as it was (a suspended one stays suspended)", async () => {
    const tenant = await provision();
    await controlTestDb.tenant.update({ where: { id: tenant.id }, data: { status: "SUSPENDED" } });

    await relinkTenant(tenant.slug, context, { config });
    await relinkTenant(tenant.slug, context, { config });

    expect(
      (await controlTestDb.tenant.findUniqueOrThrow({ where: { id: tenant.id } })).status,
    ).toBe("SUSPENDED");
  }, 120_000);

  it("does not touch another business's access", async () => {
    const first = await provision();
    const second = await provision();
    await closeAllTenantClients();
    await loseServerSideState(first.database, first.role);

    await relinkTenant(first.slug, context, { config });

    // El otro negocio nunca perdió nada y sigue entrando; el rol de uno no abre la base del otro.
    expect(await roleExists(adminUrl, second.role)).toBe(true);
    const secondEntry = await directory.lookupByHost(`${second.slug}.localhost`);
    expect(secondEntry?.state).toBe("active");
    const crossUrl = urlFor(adminUrl, { database: second.database, user: first.role });
    await expect(withClient(crossUrl, (client) => client.user.count())).rejects.toThrow();
  }, 180_000);

  it("brings an older restored database up to the current version", async () => {
    const tenant = await provision();
    const current = await readSchemaVersion(adminUrlFor(adminUrl, tenant.database));
    expect(current).toMatch(/^\d{14}_/);

    // Un respaldo de antes de la última migración: la fila de esa migración no está.
    await withClient(adminUrlFor(adminUrl, tenant.database), (client) =>
      client.$executeRawUnsafe(
        `DELETE FROM "_prisma_migrations" WHERE "migration_name" = '${current}'`,
      ),
    );
    await controlTestDb.tenant.update({
      where: { id: tenant.id },
      data: { schemaVersion: "20260101000000_antigua" },
    });
    const migrated: string[] = [];
    const report = await relinkTenant(tenant.slug, context, {
      config,
      // Aplicar la migración que faltaba: aquí se vuelve a anotar (las tablas ya la tienen).
      migrate: async (url) => {
        migrated.push(url);
        await withClient(url, (client) =>
          client.$executeRawUnsafe(
            `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, finished_at, started_at, applied_steps_count)
             VALUES (gen_random_uuid()::text, 'x', '${current}', now(), now(), 1)`,
          ),
        );
      },
    });

    expect(migrated).toHaveLength(1);
    expect(report.schemaTo).toBe(current);
    expect(
      (await controlTestDb.tenant.findUniqueOrThrow({ where: { id: tenant.id } })).schemaVersion,
    ).toBe(current);
  }, 120_000);

  it("puts a business whose restored database cannot be brought up to date in maintenance, with the reason", async () => {
    const tenant = await provision();
    // Una base atrasada (le falta la última migración) que además no se puede migrar.
    const current = await readSchemaVersion(adminUrlFor(adminUrl, tenant.database));
    await withClient(adminUrlFor(adminUrl, tenant.database), (client) =>
      client.$executeRawUnsafe(
        `DELETE FROM "_prisma_migrations" WHERE "migration_name" = '${current}'`,
      ),
    );
    await expect(
      relinkTenant(tenant.slug, context, {
        config,
        migrate: async () => {
          throw new Error("la migración no se pudo aplicar");
        },
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    const row = await controlTestDb.tenant.findUniqueOrThrow({ where: { id: tenant.id } });
    expect(row.status).toBe("MIGRATION_FAILED");
    expect(row.migrationError).toContain("la migración no se pudo aplicar");
  }, 120_000);

  it("refuses an unknown business, one without a database in the server, and a business that was never set up", async () => {
    await expect(relinkTenant("no-existe", context, { config })).rejects.toBeInstanceOf(
      NotFoundError,
    );

    const tenant = await provision();
    await closeAllTenantClients();
    await dropTenantResources(adminUrl, { database: tenant.database, role: tenant.role });
    expect(await databaseExists(adminUrl, tenant.database)).toBe(false);
    await expect(relinkTenant(tenant.slug, context, { config })).rejects.toThrow(
      /restáurala primero/,
    );

    await controlTestDb.tenant.create({
      data: { slug: "en-alta", name: "En alta", status: "PROVISIONING" },
    });
    await expect(relinkTenant("en-alta", context, { config })).rejects.toBeInstanceOf(
      ConflictError,
    );
  }, 120_000);
});
