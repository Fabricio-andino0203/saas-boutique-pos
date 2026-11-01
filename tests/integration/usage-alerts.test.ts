import { Prisma } from "@/generated/control/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTemplateDatabase, dropDatabase } from "@/lib/tenancy/provision-db";
import { adminUrlFor, dropTenantResources } from "@/lib/tenancy/provision-steps";
import { closeAllTenantClients } from "@/lib/tenancy/tenant-clients";
import { setProcessDefaultTenant } from "@/lib/tenancy/tenant-context";
import { setVault } from "@/lib/tenancy/vault";
import { collectAlerts, needsAction, STALLED_AFTER_MS } from "@/modules/platform/alerts";
import { assignPlan, createPlan } from "@/modules/platform/billing";
import { startProvisioning } from "@/modules/platform/provisioning";
import {
  collectUsage,
  getTenantUsage,
  readUsage,
  USAGE_METRICS,
  type UsageReading,
} from "@/modules/platform/usage";
import {
  closeControlTestDatabase,
  controlTestDb,
  resetControlDatabase,
} from "./helpers/control-db";

/**
 * Etapa 5: las fotos de uso (solo números de una lista blanca) y las alertas que reúnen lo que alguien debe atender.
 */

const adminUrl = process.env.DATABASE_URL_TEST as string;
const TEMPLATE = "rt5u_template";
const config = { adminUrl, templateDb: TEMPLATE };
const context = { actor: { id: "admin-1", username: "admin-prueba" }, ip: "10.0.0.1" };
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = new Date("2026-11-03T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

async function operatingTenant(slug: string, status = "ACTIVE", createdAt = ago(10 * DAY)) {
  const database = `t_${slug.replace(/-/g, "_")}`;
  return controlTestDb.tenant.create({
    data: {
      slug,
      name: `Negocio ${slug}`,
      status: status as never,
      createdAt,
      dbName: database,
      dbRole: database,
      dbCredentialEnc: "relleno",
    },
  });
}

const reading = (overrides: Partial<UsageReading> = {}): UsageReading => ({
  activeUsers: 2,
  products: 40,
  sales30d: 12,
  lastSaleAt: ago(HOUR),
  lastLoginAt: ago(2 * HOUR),
  databaseMb: 9,
  schemaVersion: "20261027000400_layaway_payment_request",
  ...overrides,
});

beforeAll(async () => {
  vi.stubEnv("TENANCY_MODE", "multi");
  setProcessDefaultTenant(undefined);
  setVault(undefined);
  await resetControlDatabase();
  await createTemplateDatabase(adminUrl, TEMPLATE);
}, 240_000);

beforeEach(async () => {
  await resetControlDatabase();
});

afterAll(async () => {
  await closeAllTenantClients();
  const tenants = await controlTestDb.tenant.findMany({ select: { dbName: true, dbRole: true } });
  for (const tenant of tenants) {
    if (tenant.dbName && tenant.dbRole) {
      await dropTenantResources(adminUrl, { database: tenant.dbName, role: tenant.dbRole });
    }
  }
  await dropDatabase(adminUrl, TEMPLATE);
  await resetControlDatabase();
  await closeControlTestDatabase();
  vi.unstubAllEnvs();
}, 180_000);

describe("usage snapshots", () => {
  it("store only the whitelisted numbers and dates — the table has no other column", () => {
    const columns = Object.keys(Prisma.TenantUsageSnapshotScalarFieldEnum).filter(
      (name) => !["id", "tenantId", "takenAt"].includes(name),
    );
    expect([...columns].sort()).toEqual([...USAGE_METRICS].sort());
  });

  it("reads the real counts of a business's database without any business data", async () => {
    const outcome = await startProvisioning(
      {
        slug: "uso-real",
        name: "Uso real",
        ownerName: "Rosa Pérez",
        ownerUsername: "rosa",
        ownerPassword: "Temporal-2026-xyz",
      },
      context,
      { config },
    );
    expect(outcome.status).toBe("SUCCEEDED");
    const tenant = await controlTestDb.tenant.findUniqueOrThrow({ where: { slug: "uso-real" } });

    const live = await readUsage(adminUrlFor(adminUrl, tenant.dbName!), NOW);
    expect(live).toMatchObject({
      activeUsers: 1,
      products: 0,
      sales30d: 0,
      lastSaleAt: null,
      lastLoginAt: null,
    });
    expect(live.databaseMb).toBeGreaterThanOrEqual(1);
    expect(live.schemaVersion).toMatch(/^\d{14}_/);
    // Lo único que sale son estas medidas: ni un nombre, ni un cliente, ni un monto.
    expect(Object.keys(live).sort()).toEqual([...USAGE_METRICS].sort());
  }, 120_000);

  it("takes a snapshot per business, isolates one that fails and prunes very old ones", async () => {
    const [good, broken] = await Promise.all([operatingTenant("buena"), operatingTenant("rota")]);
    await controlTestDb.tenantUsageSnapshot.create({
      data: { tenantId: good.id, takenAt: ago(500 * DAY), ...reading() },
    });

    const report = await collectUsage(
      {},
      {
        config,
        client: controlTestDb,
        now: () => NOW,
        read: async (url) => {
          if (url.includes(broken.dbName!)) {
            throw new Error("connection refused");
          }
          return reading();
        },
      },
    );

    expect(report.collected).toEqual(["buena"]);
    expect(report.failed).toEqual([{ slug: "rota", error: "connection refused" }]);
    const rows = await controlTestDb.tenantUsageSnapshot.findMany({ where: { tenantId: good.id } });
    expect(rows).toHaveLength(1); // la de hace 500 días se retiró
    expect(rows[0]).toMatchObject({ activeUsers: 2, products: 40, sales30d: 12, databaseMb: 9 });
  });

  it("limits collection to the businesses asked for", async () => {
    await Promise.all([operatingTenant("uno"), operatingTenant("dos")]);
    const report = await collectUsage(
      { only: ["dos"] },
      {
        config,
        client: controlTestDb,
        now: () => NOW,
        read: async () => reading(),
      },
    );
    expect(report.collected).toEqual(["dos"]);
  });

  it("shows the latest snapshot next to the limits of the business's plan", async () => {
    const tenant = await operatingTenant("con-tope");
    const plan = await createPlan(
      {
        name: "Chico",
        priceCents: 1000,
        interval: "MONTHLY",
        limits: { users: 5, products: null, terminals: null, locations: null },
        features: [],
        trialDays: 0,
        sortOrder: 0,
      },
      context,
      { client: controlTestDb, now: () => NOW },
    );
    await assignPlan(
      { slug: "con-tope", planId: plan.id, trial: true, reason: "Prueba" },
      context,
      { client: controlTestDb, now: () => NOW },
    );
    await controlTestDb.tenantUsageSnapshot.create({
      data: { tenantId: tenant.id, takenAt: ago(5 * DAY), ...reading({ activeUsers: 1 }) },
    });
    await controlTestDb.tenantUsageSnapshot.create({
      data: { tenantId: tenant.id, takenAt: ago(HOUR), ...reading({ activeUsers: 5 }) },
    });

    const usage = await getTenantUsage(tenant.id, { client: controlTestDb });
    expect(usage?.reading.activeUsers).toBe(5);
    expect(usage?.limits).toEqual({ users: 5, products: null });
    expect(await getTenantUsage("no-existe", { client: controlTestDb })).toBeNull();
  });
});

describe("alerts", () => {
  const deps = () => ({ client: controlTestDb, now: () => NOW, reconcile: false });

  async function okBackup(tenantId: string | null, database: string, at: Date) {
    return controlTestDb.tenantBackup.create({
      data: {
        scope: tenantId === null ? "CONTROL" : "TENANT",
        tenantId,
        database,
        trigger: "SCHEDULED",
        status: "OK",
        fileName: `x-${database}.dump.enc`,
        bytes: 1000,
        checksum: "c".repeat(64),
        verifiedAt: at,
        finishedAt: at,
        requestedAt: at,
      },
    });
  }

  it("is empty when everything is fine", async () => {
    const tenant = await operatingTenant("sano");
    await okBackup(tenant.id, tenant.dbName!, ago(HOUR));
    await okBackup(null, "boutique_pos_control", ago(HOUR));
    const alerts = await collectAlerts(deps());
    expect(alerts).toEqual([]);
    expect(needsAction(alerts)).toBe(false);
  });

  it("raises grave alerts for a failed backup, a business with none, a stale control backup and a business in maintenance", async () => {
    const [failed, never, broken] = await Promise.all([
      operatingTenant("fallido"),
      operatingTenant("sin-respaldo"),
      operatingTenant("en-mantenimiento", "MIGRATION_FAILED"),
    ]);
    await okBackup(failed.id, failed.dbName!, ago(40 * HOUR));
    await controlTestDb.tenantBackup.create({
      data: {
        scope: "TENANT",
        tenantId: failed.id,
        database: failed.dbName!,
        trigger: "SCHEDULED",
        status: "FAILED",
        finishedAt: ago(2 * HOUR),
        error: "x",
      },
    });
    await okBackup(broken.id, broken.dbName!, ago(HOUR));
    await okBackup(null, "boutique_pos_control", ago(30 * HOUR));
    void never;

    const alerts = await collectAlerts(deps());
    const summary = alerts.map(
      (alert) => `${alert.severity}:${alert.code}:${alert.slug ?? alert.detail ?? ""}`,
    );
    expect(summary).toEqual(
      expect.arrayContaining([
        "critical:backup_failed:fallido",
        "critical:backup_never:sin-respaldo",
        "critical:migration_failed:en-mantenimiento",
        "warning:backup_stale:control",
      ]),
    );
    expect(needsAction(alerts)).toBe(true);
    // Lo grave va primero.
    expect(alerts[0]?.severity).toBe("critical");
    expect(alerts.at(-1)?.severity).not.toBe("critical");
  });

  it("notices when the backup service is not taking requests", async () => {
    const tenant = await operatingTenant("espera");
    await okBackup(tenant.id, tenant.dbName!, ago(HOUR));
    await okBackup(null, "boutique_pos_control", ago(HOUR));
    await controlTestDb.tenantBackup.create({
      data: {
        scope: "TENANT",
        tenantId: tenant.id,
        database: tenant.dbName!,
        trigger: "MANUAL",
        status: "REQUESTED",
        requestedAt: new Date(NOW.getTime() - STALLED_AFTER_MS - 1000),
      },
    });
    const alerts = await collectAlerts(deps());
    expect(alerts).toEqual([{ code: "backup_service_stalled", severity: "critical", detail: "1" }]);
  });

  it("does not worry about a request that was just made", async () => {
    const tenant = await operatingTenant("reciente");
    await okBackup(tenant.id, tenant.dbName!, ago(HOUR));
    await okBackup(null, "boutique_pos_control", ago(HOUR));
    await controlTestDb.tenantBackup.create({
      data: {
        scope: "TENANT",
        tenantId: tenant.id,
        database: tenant.dbName!,
        trigger: "MANUAL",
        status: "REQUESTED",
        requestedAt: ago(60_000),
      },
    });
    expect(await collectAlerts(deps())).toEqual([]);
  });

  it("flags a business near the cap of its plan as information, which does not make the check fail", async () => {
    const tenant = await operatingTenant("casi-lleno");
    await okBackup(tenant.id, tenant.dbName!, ago(HOUR));
    await okBackup(null, "boutique_pos_control", ago(HOUR));
    const plan = await createPlan(
      {
        name: "Tope",
        priceCents: 1000,
        interval: "MONTHLY",
        limits: { users: 10, products: 1000, terminals: null, locations: null },
        features: [],
        trialDays: 0,
        sortOrder: 0,
      },
      context,
      { client: controlTestDb, now: () => NOW },
    );
    await assignPlan(
      { slug: "casi-lleno", planId: plan.id, trial: true, reason: "Prueba" },
      context,
      {
        client: controlTestDb,
        now: () => NOW,
      },
    );
    await controlTestDb.tenantUsageSnapshot.create({
      data: {
        tenantId: tenant.id,
        takenAt: ago(HOUR),
        ...reading({ activeUsers: 9, products: 100 }),
      },
    });

    const alerts = await collectAlerts(deps());
    expect(alerts).toEqual([
      {
        code: "near_limit",
        severity: "info",
        slug: "casi-lleno",
        name: "Negocio casi-lleno",
        detail: "users",
      },
    ]);
    expect(needsAction(alerts)).toBe(false);
  });
});
