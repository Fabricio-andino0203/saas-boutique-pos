import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { ConflictError, NotFoundError } from "@/lib/errors";
import {
  backupOverview,
  getTenantBackupStatus,
  latestUsableBackup,
  listTenantBackups,
  requestControlBackup,
  requestTenantBackup,
} from "@/modules/platform/backups";
import { assignPlan, createPlan } from "@/modules/platform/billing";
import {
  closeControlTestDatabase,
  controlTestDb,
  resetControlDatabase,
} from "./helpers/control-db";

/**
 * Etapa 5: el registro de respaldos en la base central real. El respaldo en sí lo hace el servicio `backup` (otro contenedor);
 * aquí se prueba lo que es de la aplicación: pedirlos, leer su estado y las reglas que la base misma impone al registro.
 */

const context = { actor: { id: "admin-1", username: "admin-prueba" }, ip: "10.0.0.1" };
const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-11-03T12:00:00.000Z");
const ago = (hours: number) => new Date(NOW.getTime() - hours * HOUR);
const deps = () => ({ client: controlTestDb, now: () => NOW });

async function newTenant(slug: string, status = "ACTIVE", createdAt = ago(24 * 10)) {
  const operating = ["ACTIVE", "SUSPENDED", "MIGRATION_FAILED", "PENDING_DELETION"].includes(
    status,
  );
  const database = `t_${slug.replace(/-/g, "_")}`;
  return controlTestDb.tenant.create({
    data: {
      slug,
      name: `Negocio ${slug}`,
      status: status as never,
      createdAt,
      ...(operating ? { dbName: database, dbRole: database, dbCredentialEnc: "relleno" } : {}),
    },
  });
}

/** Una fila del registro, escrita como lo hace el servicio de respaldos. */
async function backupRow(
  tenantId: string | null,
  database: string,
  overrides: Record<string, unknown> = {},
) {
  const status = (overrides.status as string | undefined) ?? "OK";
  const finishedAt = (overrides.finishedAt as Date | null | undefined) ?? ago(1);
  return controlTestDb.tenantBackup.create({
    data: {
      scope: tenantId === null ? "CONTROL" : "TENANT",
      tenantId,
      database,
      trigger: "SCHEDULED",
      status: status as never,
      requestedAt: finishedAt ?? NOW,
      ...(status === "OK"
        ? {
            fileName: `tenant-${database}-20261103T020000Z.dump.enc`,
            bytes: 125_616,
            checksum: "a".repeat(64),
            verifiedAt: finishedAt,
            finishedAt,
          }
        : { finishedAt, error: status === "FAILED" ? "pg_dump falló" : null }),
      ...overrides,
    } as never,
  });
}

beforeEach(async () => {
  await resetControlDatabase();
});

afterAll(async () => {
  await resetControlDatabase();
  await closeControlTestDatabase();
});

describe("requesting a backup", () => {
  it("leaves a requested row for the backup service and an audit entry, never the backup itself", async () => {
    const tenant = await newTenant("tienda-a");
    const { id } = await requestTenantBackup("tienda-a", context, deps());

    const row = await controlTestDb.tenantBackup.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({
      scope: "TENANT",
      tenantId: tenant.id,
      database: "t_tienda_a",
      trigger: "MANUAL",
      status: "REQUESTED",
      requestedByUsername: "admin-prueba",
      fileName: null,
    });
    const audit = await controlTestDb.platformAuditLog.findFirstOrThrow({
      where: { action: "BACKUP_REQUESTED" },
    });
    expect(audit).toMatchObject({ tenantId: tenant.id, actorUsername: "admin-prueba" });
  });

  it("refuses a second request while one is still open, and accepts it once that one finished", async () => {
    await newTenant("tienda-a");
    const { id } = await requestTenantBackup("tienda-a", context, deps());
    await expect(requestTenantBackup("tienda-a", context, deps())).rejects.toBeInstanceOf(
      ConflictError,
    );
    await controlTestDb.tenantBackup.update({ where: { id }, data: { status: "RUNNING" } });
    await expect(requestTenantBackup("tienda-a", context, deps())).rejects.toBeInstanceOf(
      ConflictError,
    );
    await controlTestDb.tenantBackup.update({
      where: { id },
      data: { status: "FAILED", finishedAt: NOW, error: "x" },
    });
    await expect(requestTenantBackup("tienda-a", context, deps())).resolves.toHaveProperty("id");
  });

  it("rejects an unknown business and one that has no database to back up", async () => {
    await newTenant("en-alta", "PROVISIONING");
    await newTenant("archivada", "DELETED");
    await expect(requestTenantBackup("no-existe", context, deps())).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(requestTenantBackup("en-alta", context, deps())).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(requestTenantBackup("archivada", context, deps())).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("requests the control database backup once at a time", async () => {
    const { id } = await requestControlBackup(context, {
      ...deps(),
      database: "boutique_pos_control",
    });
    expect(await controlTestDb.tenantBackup.findUniqueOrThrow({ where: { id } })).toMatchObject({
      scope: "CONTROL",
      tenantId: null,
      database: "boutique_pos_control",
      status: "REQUESTED",
    });
    await expect(requestControlBackup(context, deps())).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("the state of each business", () => {
  it("tells ok, stale, failed, never and pending apart, worst first in the attention list", async () => {
    const [ok, stale, failed, never, pending] = await Promise.all([
      newTenant("al-dia"),
      newTenant("atrasada"),
      newTenant("fallida"),
      newTenant("nunca"),
      newTenant("nueva", "ACTIVE", ago(5)),
    ]);
    await backupRow(ok.id, ok.dbName!, { finishedAt: ago(2) });
    await backupRow(stale.id, stale.dbName!, { finishedAt: ago(40) });
    await backupRow(failed.id, failed.dbName!, { finishedAt: ago(40) });
    await backupRow(failed.id, failed.dbName!, { status: "FAILED", finishedAt: ago(2) });
    void never;
    void pending;
    await backupRow(null, "boutique_pos_control", { finishedAt: ago(3) });

    const overview = await backupOverview(deps());
    const stateOf = (slug: string) => overview.tenants.find((row) => row.slug === slug)?.state;
    expect(stateOf("al-dia")).toBe("ok");
    expect(stateOf("atrasada")).toBe("stale");
    expect(stateOf("fallida")).toBe("failed");
    expect(stateOf("nunca")).toBe("never");
    expect(stateOf("nueva")).toBe("pending");
    expect(overview.control.state).toBe("ok");
    expect(overview.attention.map((item) => `${item.slug}:${item.state}`)).toEqual([
      "fallida:failed",
      "nunca:never",
      "atrasada:stale",
    ]);
  });

  it("flags the control database when its backup is missing or old", async () => {
    await newTenant("tienda-a");
    expect((await backupOverview(deps())).attention[0]).toMatchObject({
      kind: "control",
      state: "never",
    });
    await backupRow(null, "boutique_pos_control", { finishedAt: ago(30) });
    expect((await backupOverview(deps())).control.state).toBe("stale");
  });

  it("ignores businesses without a database in the server and shows the plan's retention days", async () => {
    await newTenant("archivada", "DELETED");
    await newTenant("en-alta", "PROVISIONING");
    const withPlan = await newTenant("con-plan");
    await newTenant("sin-plan");
    const plan = await createPlan(
      {
        name: "Largo",
        priceCents: 1000,
        interval: "MONTHLY",
        limits: { users: null, products: null, terminals: null, locations: null },
        features: [],
        trialDays: 0,
        backupRetentionDays: 90,
        sortOrder: 0,
      },
      context,
      deps(),
    );
    await assignPlan(
      { slug: "con-plan", planId: plan.id, trial: true, reason: "Alta de prueba" },
      context,
      deps(),
    );

    const overview = await backupOverview(deps());
    expect(overview.tenants.map((row) => row.slug).sort()).toEqual(["con-plan", "sin-plan"]);
    const byPlan = overview.tenants.find((row) => row.slug === "con-plan");
    const none = overview.tenants.find((row) => row.slug === "sin-plan");
    expect(byPlan).toMatchObject({ retentionDays: 90, retentionFromPlan: true });
    expect(none).toMatchObject({ retentionDays: 30, retentionFromPlan: false });
    expect(
      (await getTenantBackupStatus(withPlan.id, withPlan.createdAt, deps())).retentionDays,
    ).toBe(90);
  });

  it("lists a business's backups newest first and picks the newest usable file for a restore", async () => {
    const tenant = await newTenant("tienda-a");
    await backupRow(tenant.id, tenant.dbName!, { finishedAt: ago(50) });
    const newest = await backupRow(tenant.id, tenant.dbName!, {
      finishedAt: ago(2),
      fileName: "tenant-t_tienda_a-20261103T100000Z.dump.enc",
    });
    await backupRow(tenant.id, tenant.dbName!, { status: "FAILED", finishedAt: ago(1) });

    const list = await listTenantBackups(tenant.id, {}, deps());
    expect(list.map((row) => row.status)).toEqual(["FAILED", "OK", "OK"]);
    // El fallido es el más reciente, pero para restaurar sirve el último BUENO.
    expect((await latestUsableBackup(tenant.id, deps()))?.id).toBe(newest.id);

    // Un archivo retirado por la retención ya no sirve para restaurar.
    await controlTestDb.tenantBackup.update({
      where: { id: newest.id },
      data: { prunedAt: NOW },
    });
    expect((await latestUsableBackup(tenant.id, deps()))?.id).not.toBe(newest.id);
  });
});

describe("rules the database enforces on the registry", () => {
  it("does not accept a good backup without its file, size, fingerprint and verification", async () => {
    const tenant = await newTenant("tienda-a");
    await expect(
      controlTestDb.tenantBackup.create({
        data: {
          scope: "TENANT",
          tenantId: tenant.id,
          database: "t_x",
          trigger: "MANUAL",
          status: "OK",
        },
      }),
    ).rejects.toThrow(/TenantBackup_ok_is_verified/);
  });

  it("ties every backup to a business except the control database's", async () => {
    const tenant = await newTenant("tienda-a");
    await expect(
      controlTestDb.tenantBackup.create({
        data: { scope: "TENANT", database: "t_x", trigger: "MANUAL", status: "REQUESTED" },
      }),
    ).rejects.toThrow(/TenantBackup_scope_tenant/);
    await expect(
      controlTestDb.tenantBackup.create({
        data: {
          scope: "CONTROL",
          tenantId: tenant.id,
          database: "x",
          trigger: "MANUAL",
          status: "REQUESTED",
        },
      }),
    ).rejects.toThrow(/TenantBackup_scope_tenant/);
  });

  it("only lets a good backup be marked as pruned, and refuses to delete a business that has backups", async () => {
    const tenant = await newTenant("tienda-a");
    const failed = await backupRow(tenant.id, tenant.dbName!, { status: "FAILED" });
    await expect(
      controlTestDb.tenantBackup.update({ where: { id: failed.id }, data: { prunedAt: NOW } }),
    ).rejects.toThrow(/TenantBackup_pruned_was_ok/);
    await expect(controlTestDb.tenant.delete({ where: { id: tenant.id } })).rejects.toThrow();
  });

  it("keeps a plan's retention between a week and ten years", async () => {
    for (const days of [6, 3651]) {
      await expect(
        controlTestDb.plan.create({
          data: {
            name: `Plan ${days}`,
            priceCents: 1,
            features: [],
            backupRetentionDays: days,
          },
        }),
      ).rejects.toThrow(/Plan_backup_retention_range/);
    }
  });
});
