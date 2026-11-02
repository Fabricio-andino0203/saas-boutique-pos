import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { ConflictError, NotFoundError } from "@/lib/errors";
import { createControlDirectory } from "@/lib/tenancy/control-directory";
import {
  createTemplateDatabase,
  dropDatabase,
  urlFor,
  withClient,
} from "@/lib/tenancy/provision-db";
import { dropTenantResources, roleExists } from "@/lib/tenancy/provision-steps";
import { closeAllTenantClients } from "@/lib/tenancy/tenant-clients";
import { runWithTenant, setProcessDefaultTenant } from "@/lib/tenancy/tenant-context";
import { getVault, setVault, vaultContext } from "@/lib/tenancy/vault";
import { db } from "@/lib/db";
import { collectAlerts } from "@/modules/platform/alerts";
import { startProvisioning } from "@/modules/platform/provisioning";
import { relinkTenant } from "@/modules/platform/restore";
import { limitStoreRole } from "@/modules/platform/store-role";
import {
  closeControlTestDatabase,
  controlTestDb,
  resetControlDatabase,
} from "./helpers/control-db";

/**
 * Etapa 6: la tienda adoptada (el negocio #1) atendía con la cuenta principal del servidor. `limitStoreRole` le da el mismo rol
 * limitado que a los demás. Aquí se vuelve a dejar a un negocio como lo deja una adopción (su rol es la cuenta principal y su
 * credencial, la contraseña de esa cuenta) y se comprueba el cambio y todo lo que no debe cambiar.
 */

const adminUrl = process.env.DATABASE_URL_TEST as string;
const TEMPLATE = "sr6_template";
const config = { adminUrl, templateDb: TEMPLATE };
const OWNER_PASSWORD = "Temporal-2026-xyz";
const context = { actor: { id: "admin-1", username: "admin-prueba" }, ip: "10.0.0.1" };
const directory = createControlDirectory({ baseDomain: "localhost", ttlMs: 0 });

const mainAccount = (() => {
  const url = new URL(adminUrl);
  return { user: decodeURIComponent(url.username), password: decodeURIComponent(url.password) };
})();

let counter = 0;
type Provisioned = { slug: string; id: string; database: string; role: string };

async function provision(): Promise<Provisioned> {
  counter += 1;
  const slug = `tienda-rol-${counter}`;
  const outcome = await startProvisioning(
    {
      slug,
      name: `Tienda del rol ${counter}`,
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

/** Como la deja `platform:adopt-store`: atiende con la cuenta principal y su contraseña está en la bóveda. */
async function makeItAnAdoptedStore(tenant: Provisioned): Promise<void> {
  await closeAllTenantClients();
  await withClient(urlFor(adminUrl, { database: tenant.database }), (client) =>
    client.$executeRawUnsafe(`DROP OWNED BY "${tenant.role}"`),
  );
  await withClient(urlFor(adminUrl, { database: "postgres" }), async (admin) => {
    await admin.$executeRawUnsafe(
      `REVOKE CONNECT ON DATABASE "${tenant.database}" FROM "${tenant.role}"`,
    );
    await admin.$executeRawUnsafe(`DROP ROLE "${tenant.role}"`);
  });
  await controlTestDb.tenant.update({
    where: { id: tenant.id },
    data: {
      dbRole: mainAccount.user,
      dbCredentialEnc: getVault().encrypt(
        mainAccount.password,
        vaultContext.tenantDatabase(tenant.id),
      ),
    },
  });
}

async function cleanUp(): Promise<void> {
  const tenants = await controlTestDb.tenant.findMany({ select: { id: true, dbName: true } });
  for (const tenant of tenants) {
    if (tenant.dbName) {
      await dropTenantResources(adminUrl, { database: tenant.dbName, role: `t_${tenant.id}` });
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

describe("giving the adopted store its own limited role", () => {
  it("moves the store from the main account to a role that can only read and write its own data", async () => {
    const tenant = await provision();
    await makeItAnAdoptedStore(tenant);
    expect(
      (await controlTestDb.tenant.findUniqueOrThrow({ where: { id: tenant.id } })).dbRole,
    ).toBe(mainAccount.user);
    // Mientras tanto la tienda aparece en la lista de alertas como «sin rol propio».
    const before = await collectAlerts({ reconcile: false });
    expect(
      before.some((alert) => alert.code === "store_unrestricted" && alert.slug === tenant.slug),
    ).toBe(true);

    const report = await limitStoreRole(tenant.slug, context, { config });
    expect(report).toMatchObject({
      slug: tenant.slug,
      database: tenant.database,
      role: `t_${tenant.id}`,
      alreadyLimited: false,
      usersVisible: 1,
    });

    // La bóveda guarda la contraseña nueva (no la de la cuenta principal) y la aplicación entra con el rol nuevo.
    const row = await controlTestDb.tenant.findUniqueOrThrow({ where: { id: tenant.id } });
    expect(row.dbRole).toBe(`t_${tenant.id}`);
    const stored = getVault().decrypt(row.dbCredentialEnc!, vaultContext.tenantDatabase(tenant.id));
    expect(stored).not.toBe(mainAccount.password);
    const entry = await directory.lookupByHost(`${tenant.slug}.localhost`);
    expect(entry?.state).toBe("active");
    const ref = (entry as { state: "active"; tenant: { id: string; databaseUrl: string } }).tenant;
    const [who] = await runWithTenant(
      ref,
      () => db.$queryRaw<{ me: string }[]>`SELECT current_user AS me`,
    );
    expect(who?.me).toBe(`t_${tenant.id}`);

    // El rol no es superusuario, tiene tope de conexiones y no puede cambiar el esquema ni crear roles o bases.
    const [limits] = await withClient(
      urlFor(adminUrl, { database: "postgres" }),
      (admin) =>
        admin.$queryRaw<
          {
            rolsuper: boolean;
            rolcreatedb: boolean;
            rolcreaterole: boolean;
            rolconnlimit: number;
          }[]
        >`
        SELECT rolsuper, rolcreatedb, rolcreaterole, rolconnlimit FROM pg_roles WHERE rolname = ${`t_${tenant.id}`}
      `,
    );
    expect(limits).toEqual({
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolconnlimit: 10,
    });
    const asRole = urlFor(adminUrl, {
      database: tenant.database,
      user: `t_${tenant.id}`,
      password: stored,
    });
    await expect(
      withClient(asRole, (c) => c.$executeRawUnsafe(`CREATE TABLE intruso (id int)`)),
    ).rejects.toThrow();
    await expect(
      withClient(asRole, (c) => c.$executeRawUnsafe(`DROP TABLE "Sale"`)),
    ).rejects.toThrow();
    await expect(
      withClient(asRole, (c) => c.$executeRawUnsafe(`CREATE ROLE intruso`)),
    ).rejects.toThrow();

    // La alerta desaparece y queda en la auditoría, sin secretos.
    const after = await collectAlerts({ reconcile: false });
    expect(
      after.some((alert) => alert.code === "store_unrestricted" && alert.slug === tenant.slug),
    ).toBe(false);
    const audit = await controlTestDb.platformAuditLog.findFirstOrThrow({
      where: { action: "TENANT_STORE_ROLE_LIMITED", tenantId: tenant.id },
    });
    expect(audit.details).toMatchObject({
      slug: tenant.slug,
      from: mainAccount.user,
      to: `t_${tenant.id}`,
    });
    expect(JSON.stringify(audit)).not.toContain(stored);
    expect(JSON.stringify(audit)).not.toContain(mainAccount.password);
  }, 180_000);

  it("keeps the new role away from the other businesses", async () => {
    const store = await provision();
    const other = await provision();
    await makeItAnAdoptedStore(store);
    await limitStoreRole(store.slug, context, { config });

    expect(await roleExists(adminUrl, other.role)).toBe(true);
    const stored = getVault().decrypt(
      (await controlTestDb.tenant.findUniqueOrThrow({ where: { id: store.id } })).dbCredentialEnc!,
      vaultContext.tenantDatabase(store.id),
    );
    const crossUrl = urlFor(adminUrl, {
      database: other.database,
      user: `t_${store.id}`,
      password: stored,
    });
    await expect(withClient(crossUrl, (client) => client.user.count())).rejects.toThrow();
  }, 180_000);

  it("is safe to repeat: the second time it only reapplies the permissions and keeps the credential", async () => {
    const tenant = await provision();
    await makeItAnAdoptedStore(tenant);
    await limitStoreRole(tenant.slug, context, { config });
    const first = (await controlTestDb.tenant.findUniqueOrThrow({ where: { id: tenant.id } }))
      .dbCredentialEnc;

    const again = await limitStoreRole(tenant.slug, context, { config });
    expect(again.alreadyLimited).toBe(true);
    const second = (await controlTestDb.tenant.findUniqueOrThrow({ where: { id: tenant.id } }))
      .dbCredentialEnc;
    expect(getVault().decrypt(second!, vaultContext.tenantDatabase(tenant.id))).toBe(
      getVault().decrypt(first!, vaultContext.tenantDatabase(tenant.id)),
    );
    expect(
      await controlTestDb.platformAuditLog.count({
        where: { action: "TENANT_STORE_ROLE_LIMITED", tenantId: tenant.id },
      }),
    ).toBe(1);
  }, 180_000);

  it("is brought back by the restore step on a server that lost the role (disaster recovery)", async () => {
    const tenant = await provision();
    await makeItAnAdoptedStore(tenant);
    await limitStoreRole(tenant.slug, context, { config });
    await closeAllTenantClients();
    await withClient(urlFor(adminUrl, { database: tenant.database }), (client) =>
      client.$executeRawUnsafe(`DROP OWNED BY "t_${tenant.id}"`),
    );
    await withClient(urlFor(adminUrl, { database: "postgres" }), async (admin) => {
      await admin.$executeRawUnsafe(
        `REVOKE CONNECT ON DATABASE "${tenant.database}" FROM "t_${tenant.id}"`,
      );
      await admin.$executeRawUnsafe(`DROP ROLE "t_${tenant.id}"`);
    });

    const report = await relinkTenant(tenant.slug, context, { config });
    expect(report).toMatchObject({ roleManaged: true, usersVisible: 1 });
    expect(await roleExists(adminUrl, `t_${tenant.id}`)).toBe(true);
  }, 180_000);

  it("refuses a business that does not exist or has no database", async () => {
    await expect(limitStoreRole("no-existe", context, { config })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const tenant = await provision();
    await controlTestDb.tenant.update({ where: { id: tenant.id }, data: { status: "DELETED" } });
    await expect(limitStoreRole(tenant.slug, context, { config })).rejects.toBeInstanceOf(
      ConflictError,
    );
  }, 180_000);
});
