import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { createControlDirectory } from "@/lib/tenancy/control-directory";
import { createTemplateDatabase, dropDatabase, withClient } from "@/lib/tenancy/provision-db";
import { adminUrlFor, dropTenantResources } from "@/lib/tenancy/provision-steps";
import { closeAllTenantClients } from "@/lib/tenancy/tenant-clients";
import { runWithTenant, setProcessDefaultTenant } from "@/lib/tenancy/tenant-context";
import { setVault } from "@/lib/tenancy/vault";
import { login } from "@/modules/auth/service";
import { startProvisioning } from "@/modules/platform/provisioning";
import {
  closeSupportSession,
  countOpenSupportSessions,
  getOpenSupportSession,
  listSupportSessions,
  openSupportSession,
  resetBusinessUserPassword,
  unlockBusinessUser,
  viewSupport,
} from "@/modules/platform/support";
import {
  closeControlTestDatabase,
  controlTestDb,
  resetControlDatabase,
} from "./helpers/control-db";

/**
 * Etapa 5: las sesiones de soporte. Sin una sesión abierta (con motivo y duración) el panel no lee nada de un negocio; abrirla
 * deja un aviso en la auditoría del propio negocio; cada vista y cada acción queda en la auditoría de la plataforma.
 */

const adminUrl = process.env.DATABASE_URL_TEST as string;
const TEMPLATE = "rt5s_template";
const config = { adminUrl, templateDb: TEMPLATE };
const OWNER_PASSWORD = "Temporal-2026-xyz";
const MINUTE = 60_000;
const NOW = new Date("2026-11-03T12:00:00.000Z");
const later = (minutes: number) => new Date(NOW.getTime() + minutes * MINUTE);
const directory = createControlDirectory({ baseDomain: "localhost", ttlMs: 0 });

const maria = { id: "admin-maria", username: "maria" };
const pedro = { id: "admin-pedro", username: "pedro" };
const asMaria = { actor: maria, ip: "10.0.0.1" };
const asPedro = { actor: pedro, ip: "10.0.0.2" };
const deps = (now: Date = NOW) => ({ config, client: controlTestDb, now: () => now });

let counter = 0;
async function provision(): Promise<{ id: string; slug: string; dbName: string }> {
  counter += 1;
  const slug = `soporte-${counter}`;
  const outcome = await startProvisioning(
    {
      slug,
      name: `Boutique de soporte ${counter}`,
      ownerName: "Rosa Pérez",
      ownerUsername: "rosa",
      ownerPassword: OWNER_PASSWORD,
    },
    asMaria,
    { config },
  );
  expect(outcome.status).toBe("SUCCEEDED");
  const tenant = await controlTestDb.tenant.findUniqueOrThrow({ where: { slug } });
  return { id: tenant.id, slug, dbName: tenant.dbName! };
}

const REASON = "La dueña no puede entrar después de un cambio de teléfono";

async function businessAudit(dbName: string, action: string) {
  return withClient(adminUrlFor(adminUrl, dbName), (client) =>
    client.auditLog.findMany({ where: { action }, orderBy: { createdAt: "asc" } }),
  );
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

describe("opening a support session", () => {
  it("needs a readable reason, one of the allowed durations and a person to answer for it", async () => {
    const tenant = await provision();
    for (const reason of ["", "corto", "x".repeat(301)]) {
      await expect(
        openSupportSession({ slug: tenant.slug, reason, minutes: 30 }, asMaria, deps()),
      ).rejects.toBeInstanceOf(ValidationError);
    }
    for (const minutes of [0, 10, 45, 121, 600]) {
      await expect(
        openSupportSession({ slug: tenant.slug, reason: REASON, minutes }, asMaria, deps()),
      ).rejects.toBeInstanceOf(ValidationError);
    }
    // Un proceso del sistema no abre sesiones: tiene que haber una persona.
    await expect(
      openSupportSession(
        { slug: tenant.slug, reason: REASON, minutes: 30 },
        { actor: null },
        deps(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      openSupportSession({ slug: "no-existe", reason: REASON, minutes: 30 }, asMaria, deps()),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await controlTestDb.supportSession.count()).toBe(0);
  }, 120_000);

  it("is refused for a business that has no database, and for one that was archived", async () => {
    await controlTestDb.tenant.create({
      data: { slug: "en-alta", name: "En alta", status: "PROVISIONING" },
    });
    await expect(
      openSupportSession({ slug: "en-alta", reason: REASON, minutes: 30 }, asMaria, deps()),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("records who, why and until when — and leaves a notice in the business's own audit", async () => {
    const tenant = await provision();
    const session = await openSupportSession(
      { slug: tenant.slug, reason: REASON, minutes: 30 },
      asMaria,
      deps(),
    );
    expect(session).toMatchObject({ adminUsername: "maria", reason: REASON, endedAt: null });
    expect(session.expiresAt.toISOString()).toBe(later(30).toISOString());

    const platformAudit = await controlTestDb.platformAuditLog.findFirstOrThrow({
      where: { action: "SUPPORT_SESSION_OPENED", tenantId: tenant.id },
    });
    expect(platformAudit).toMatchObject({ actorUsername: "maria", targetId: session.id });
    expect(platformAudit.details).toMatchObject({ reason: REASON, minutes: 30 });

    // El negocio se entera: queda una línea en SU auditoría con el motivo y quién.
    const [notice] = await businessAudit(tenant.dbName, "SUPPORT_SESSION_OPENED");
    expect(notice).toMatchObject({
      userId: null,
      entityType: "Support",
      entityId: session.id,
      reason: REASON,
    });
    expect(JSON.stringify(notice?.after)).toContain("@maria");
  }, 120_000);

  it("allows one open session per person and business; opening another closes the first, and a colleague has her own", async () => {
    const tenant = await provision();
    const first = await openSupportSession(
      { slug: tenant.slug, reason: REASON, minutes: 15 },
      asMaria,
      deps(),
    );
    const second = await openSupportSession(
      { slug: tenant.slug, reason: `${REASON} (otra vez)`, minutes: 60 },
      asMaria,
      deps(NOW),
    );
    expect(second.id).not.toBe(first.id);
    expect(
      (await controlTestDb.supportSession.findUniqueOrThrow({ where: { id: first.id } })).endedAt,
    ).not.toBeNull();
    expect((await getOpenSupportSession(tenant.slug, maria.id, deps()))?.id).toBe(second.id);

    await openSupportSession({ slug: tenant.slug, reason: REASON, minutes: 15 }, asPedro, deps());
    expect(await countOpenSupportSessions(deps())).toBeGreaterThanOrEqual(2);
    // La base misma lo exige: no se pueden tener dos abiertas.
    await expect(
      controlTestDb.supportSession.create({
        data: {
          tenantId: tenant.id,
          adminId: maria.id,
          adminUsername: "maria",
          reason: REASON,
          startedAt: NOW,
          expiresAt: later(10),
        },
      }),
    ).rejects.toThrow(/SupportSession_one_open/);
  }, 120_000);

  it("never lasts more than two hours, whatever the code asks for", async () => {
    const tenant = await provision();
    await expect(
      controlTestDb.supportSession.create({
        data: {
          tenantId: tenant.id,
          adminId: maria.id,
          adminUsername: "maria",
          reason: REASON,
          startedAt: NOW,
          expiresAt: later(121),
        },
      }),
    ).rejects.toThrow(/SupportSession_duration/);
    await expect(
      controlTestDb.supportSession.create({
        data: {
          tenantId: tenant.id,
          adminId: maria.id,
          adminUsername: "maria",
          reason: "corto",
          startedAt: NOW,
          expiresAt: later(10),
        },
      }),
    ).rejects.toThrow(/SupportSession_reason_length/);
  });
});

describe("what a support session can see", () => {
  it("shows nothing without a session, after it expires, and after it is closed", async () => {
    const tenant = await provision();
    await expect(viewSupport(tenant.slug, asMaria, deps())).rejects.toThrow(/sesión de soporte/);

    await openSupportSession({ slug: tenant.slug, reason: REASON, minutes: 15 }, asMaria, deps());
    await expect(viewSupport(tenant.slug, asMaria, deps(later(5)))).resolves.toBeDefined();
    // Venció (y nadie la cerró): ya no vale.
    await expect(viewSupport(tenant.slug, asMaria, deps(later(16)))).rejects.toBeInstanceOf(
      ConflictError,
    );
    // La sesión de una persona no sirve a otra.
    await expect(viewSupport(tenant.slug, asPedro, deps(later(5)))).rejects.toBeInstanceOf(
      ConflictError,
    );

    await closeSupportSession(tenant.slug, asMaria, deps(later(6)));
    await expect(viewSupport(tenant.slug, asMaria, deps(later(7)))).rejects.toBeInstanceOf(
      ConflictError,
    );
    const closedAudit = await controlTestDb.platformAuditLog.count({
      where: { action: "SUPPORT_SESSION_CLOSED", tenantId: tenant.id },
    });
    expect(closedAudit).toBe(1);
  }, 120_000);

  it("shows the people, sales, cash and audit of the business — without secrets — and leaves a record of the look", async () => {
    const tenant = await provision();
    await openSupportSession({ slug: tenant.slug, reason: REASON, minutes: 30 }, asMaria, deps());

    const view = await viewSupport(tenant.slug, asMaria, deps(later(1)));
    expect(view.users).toHaveLength(1);
    expect(view.users[0]).toMatchObject({ username: "rosa", role: "OWNER", isActive: true });
    expect(view.sales).toEqual([]);
    expect(view.cash).toEqual([]);
    expect(view.audit.map((row) => row.action)).toContain("SUPPORT_SESSION_OPENED");

    // Ni la huella de la contraseña ni nada parecido sale del negocio.
    const everything = JSON.stringify(view);
    expect(everything).not.toMatch(/argon2|passwordHash|pinHash|sessionToken/i);
    expect(Object.keys(view.users[0]!).sort()).toEqual(
      [
        "createdAt",
        "failedLogins",
        "id",
        "isActive",
        "lastLoginAt",
        "lockedUntil",
        "name",
        "role",
        "username",
      ].sort(),
    );

    const looks = await controlTestDb.platformAuditLog.findMany({
      where: { action: "SUPPORT_VIEWED", tenantId: tenant.id },
    });
    expect(looks).toHaveLength(1);
    expect(looks[0]).toMatchObject({ actorUsername: "maria", ip: "10.0.0.1" });
    expect(looks[0]?.details).toMatchObject({
      slug: tenant.slug,
      sections: ["users", "sales", "cash", "audit"],
    });
  }, 120_000);
});

describe("the two corrections support can make", () => {
  it("unlocks a person who ran out of attempts, and leaves a record on both sides", async () => {
    const tenant = await provision();
    const url = adminUrlFor(adminUrl, tenant.dbName);
    const rosa = await withClient(url, (client) =>
      client.user.update({
        where: { username: "rosa" },
        data: { failedLogins: 5, lockedUntil: new Date(Date.now() + 3_600_000) },
      }),
    );
    await openSupportSession({ slug: tenant.slug, reason: REASON, minutes: 30 }, asMaria, deps());

    await expect(
      unlockBusinessUser({ slug: tenant.slug, userId: rosa.id }, asMaria, deps(later(1))),
    ).resolves.toEqual({ username: "rosa" });
    const after = await withClient(url, (client) =>
      client.user.findUniqueOrThrow({ where: { id: rosa.id } }),
    );
    expect(after).toMatchObject({ failedLogins: 0, lockedUntil: null });
    expect(after.passwordHash).toBe(rosa.passwordHash); // desbloquear no toca la contraseña

    const [mine] = await businessAudit(tenant.dbName, "SUPPORT_USER_UNLOCKED");
    expect(mine).toMatchObject({ entityType: "User", entityId: rosa.id, reason: REASON });
    expect(
      await controlTestDb.platformAuditLog.count({
        where: { action: "SUPPORT_USER_UNLOCKED", tenantId: tenant.id },
      }),
    ).toBe(1);

    await expect(
      unlockBusinessUser({ slug: tenant.slug, userId: "no-existe" }, asMaria, deps(later(2))),
    ).rejects.toBeInstanceOf(NotFoundError);
  }, 120_000);

  it("needs the session to act, not just to look", async () => {
    const tenant = await provision();
    await expect(
      unlockBusinessUser({ slug: tenant.slug, userId: "x" }, asMaria, deps()),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      resetBusinessUserPassword({ slug: tenant.slug, userId: "x" }, asMaria, deps()),
    ).rejects.toBeInstanceOf(ConflictError);
  }, 120_000);

  it("gives a temporary password once: the person can sign in with it, the old one stops working, and it is written nowhere", async () => {
    const tenant = await provision();
    const url = adminUrlFor(adminUrl, tenant.dbName);
    const rosa = await withClient(url, (client) =>
      client.user.findUniqueOrThrow({ where: { username: "rosa" } }),
    );
    await openSupportSession({ slug: tenant.slug, reason: REASON, minutes: 30 }, asMaria, deps());

    const { username, temporaryPassword } = await resetBusinessUserPassword(
      { slug: tenant.slug, userId: rosa.id },
      asMaria,
      deps(later(1)),
    );
    expect(username).toBe("rosa");
    expect(temporaryPassword).toHaveLength(16);

    const entry = await directory.lookupByHost(`${tenant.slug}.localhost`);
    expect(entry?.state).toBe("active");
    const ref = (entry as { state: "active"; tenant: { id: string; databaseUrl: string } }).tenant;
    const session = await runWithTenant(ref, () =>
      login({ username: "rosa", password: temporaryPassword, ip: "10.0.0.9" }),
    );
    expect(session.token).toBeTruthy();
    await expect(
      runWithTenant(ref, () =>
        login({ username: "rosa", password: OWNER_PASSWORD, ip: "10.0.0.9" }),
      ),
    ).rejects.toThrow();

    // Ni la contraseña ni su huella están en ninguna auditoría.
    const [mine] = await businessAudit(tenant.dbName, "SUPPORT_CREDENTIALS_RESET");
    expect(mine).toMatchObject({ entityType: "User", entityId: rosa.id, reason: REASON });
    const platformRows = await controlTestDb.platformAuditLog.findMany({
      where: { tenantId: tenant.id },
    });
    const everywhere = JSON.stringify([mine, platformRows]);
    expect(everywhere).not.toContain(temporaryPassword);
    expect(everywhere).not.toMatch(/argon2/i);
    expect(platformRows.filter((row) => row.action === "SUPPORT_PASSWORD_RESET")).toHaveLength(1);
  }, 120_000);

  it("lists the history of sessions of a business, newest first", async () => {
    const tenant = await provision();
    await openSupportSession({ slug: tenant.slug, reason: REASON, minutes: 15 }, asMaria, deps());
    await closeSupportSession(tenant.slug, asMaria, deps(later(1)));
    await openSupportSession(
      { slug: tenant.slug, reason: `${REASON} 2`, minutes: 15 },
      asPedro,
      deps(later(2)),
    );
    const rows = await listSupportSessions(tenant.id, { client: controlTestDb });
    expect(rows.map((row) => row.adminUsername)).toEqual(["pedro", "maria"]);
  }, 120_000);
});
