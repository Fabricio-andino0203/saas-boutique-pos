import { spawnSync } from "node:child_process";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
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
  roleExists,
} from "@/lib/tenancy/provision-steps";
import { closeAllTenantClients } from "@/lib/tenancy/tenant-clients";
import { runWithTenant, setProcessDefaultTenant } from "@/lib/tenancy/tenant-context";
import { getVault, setVault, vaultContext } from "@/lib/tenancy/vault";
import { login } from "@/modules/auth/service";
import { createPlan, setPlanActive } from "@/modules/platform/billing";
import {
  provisioningConfig,
  ProvisioningUnavailableError,
  resumeProvisioning,
  startProvisioning,
  undoProvisioning,
  type ProvisionInput,
  type ProvisionStepName,
  type StepState,
} from "@/modules/platform/provisioning";
import { controlTestUrl, TEST_MASTER_KEY } from "./helpers/control-url";
import {
  closeControlTestDatabase,
  controlTestDb,
  resetControlDatabase,
} from "./helpers/control-db";

/**
 * Etapa 3 de la propuesta SaaS: el alta automática de un negocio. Cada prueba parte de una base central vacía de negocios y
 * limpia las bases y roles que creó: el servidor de pruebas queda como estaba.
 */

const adminUrl = process.env.DATABASE_URL_TEST as string;
const TEMPLATE = "rt3_template";
const config = { adminUrl, templateDb: TEMPLATE };
const OWNER_PASSWORD = "Temporal-2026-xyz";
const actor = { id: "admin-1", username: "admin-prueba" };
const context = { actor, ip: "10.0.0.1" };

let counter = 0;
const input = (overrides: Partial<ProvisionInput> = {}): ProvisionInput => {
  counter += 1;
  return {
    slug: `prueba-${counter}`,
    name: `Boutique de prueba ${counter}`,
    ownerName: "Rosa Pérez",
    ownerUsername: "rosa",
    ownerPassword: OWNER_PASSWORD,
    ...overrides,
  };
};

const serverUrl = () => urlFor(adminUrl, { database: "postgres" });
const directory = createControlDirectory({ baseDomain: "localhost", ttlMs: 0 });

async function tenantRow(slug: string) {
  return controlTestDb.tenant.findUniqueOrThrow({ where: { slug } });
}

async function runsOf(slug: string) {
  const tenant = await tenantRow(slug);
  return controlTestDb.provisioningRun.findMany({
    where: { tenantId: tenant.id },
    orderBy: { startedAt: "asc" },
  });
}

const stepsOf = (run: { steps: unknown }) => run.steps as StepState[];

async function databaseOid(name: string): Promise<number | undefined> {
  return withClient(serverUrl(), async (client) => {
    const rows = await client.$queryRaw<{ oid: number }[]>`
      SELECT oid::int AS oid FROM pg_database WHERE datname = ${name}
    `;
    return rows[0]?.oid;
  });
}

/** Lo que `tenantId` creó en el servidor: nada debe sobrevivir a una prueba. */
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

describe("registering a business end to end", () => {
  it("leaves a working business: its own database and role, the base data, the owner, and an audit trail", async () => {
    const data = input({ ownerEmail: "rosa@example.com" });
    const outcome = await startProvisioning(data, context, { config });
    expect(outcome).toMatchObject({ status: "SUCCEEDED", slug: data.slug });

    const tenant = await tenantRow(data.slug);
    expect(tenant).toMatchObject({
      status: "ACTIVE",
      name: data.name,
      ownerEmail: "rosa@example.com",
      dbServerId: "primary",
    });
    expect(tenant.dbName).toBe(`t_${tenant.id}`);
    expect(tenant.dbRole).toBe(`t_${tenant.id}`);
    expect(tenant.schemaVersion).toMatch(/^\d{14}_/);

    // La receta quedó anotada paso a paso y sin la contraseña temporal.
    const [run] = await runsOf(data.slug);
    expect(run).toMatchObject({ status: "SUCCEEDED", attempt: 1, secretEnc: null, error: null });
    expect(stepsOf(run!).map((step) => [step.name, step.status])).toEqual([
      ["validate", "DONE"],
      ["role", "DONE"],
      ["database", "DONE"],
      ["migrate", "DONE"],
      ["seed", "DONE"],
      ["owner", "DONE"],
      ["finalize", "DONE"],
    ]);

    // La contraseña de la base va cifrada y atada a este negocio.
    expect(tenant.dbCredentialEnc).toMatch(/^v1\./);
    const password = getVault().decrypt(
      tenant.dbCredentialEnc as string,
      vaultContext.tenantDatabase(tenant.id),
    );
    expect(tenant.dbCredentialEnc).not.toContain(password);

    // Con el rol limitado: lee y escribe datos, pero no cambia el esquema ni entra a otra base.
    const asApp = urlFor(adminUrl, { database: tenant.dbName!, user: tenant.dbRole!, password });
    await withClient(asApp, async (client) => {
      expect(await client.location.count()).toBe(1);
      expect(await client.terminal.count()).toBe(1);
      expect((await client.businessProfile.findFirstOrThrow()).legalName).toBe(data.name);
      expect(await client.user.count({ where: { role: "OWNER" } })).toBe(1);
      await expect(client.$executeRawUnsafe("CREATE TABLE intruso (i int)")).rejects.toThrow();
    });
    // (Que su rol no entra a la base de otro negocio se comprueba en la prueba del lote, con varios negocios a la vez.)

    // La aplicación lo atiende por su subdominio y el propietario puede entrar con la contraseña temporal.
    const entry = await directory.lookupByHost(`${data.slug}.localhost`);
    expect(entry?.state).toBe("active");
    const session = await runWithTenant(
      (entry as { state: "active"; tenant: { id: string; databaseUrl: string } }).tenant,
      () => login({ username: "rosa", password: OWNER_PASSWORD, ip: "10.0.0.2" }),
    );
    expect(session.token).toBeTruthy();

    // Su primer respaldo quedó pedido al activarlo, sin esperar a la noche.
    expect(
      await controlTestDb.tenantBackup.findMany({ where: { tenantId: tenant.id } }),
    ).toMatchObject([
      { scope: "TENANT", database: tenant.dbName, trigger: "SCHEDULED", status: "REQUESTED" },
    ]);

    // Quedó en la auditoría, sin ningún secreto.
    const audit = await controlTestDb.platformAuditLog.findMany({
      where: { tenantId: tenant.id },
      orderBy: { at: "asc" },
    });
    expect(audit.map((row) => row.action)).toEqual([
      "TENANT_PROVISION_STARTED",
      "TENANT_PROVISIONED",
    ]);
    expect(audit[0]).toMatchObject({ actorUsername: actor.username, ip: "10.0.0.1" });
    expect(JSON.stringify(audit)).not.toContain(OWNER_PASSWORD);
    expect(JSON.stringify(audit)).not.toContain(password);
  }, 120_000);

  it("refuses what is not valid or already exists, before creating anything", async () => {
    const before = await controlTestDb.tenant.count();
    for (const bad of [
      input({ slug: "admin" }),
      input({ slug: "Con Espacios" }),
      input({ slug: "-x" }),
      input({ name: "x" }),
      input({ ownerUsername: "no válido!" }),
      input({ ownerPassword: "corta" }),
      input({ ownerEmail: "sin-arroba" }),
    ]) {
      await expect(startProvisioning(bad, context, { config })).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
    expect(await controlTestDb.tenant.count()).toBe(before);

    const [first] = await controlTestDb.tenant.findMany({ take: 1 });
    await expect(
      startProvisioning(input({ slug: first!.slug }), context, { config }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await controlTestDb.tenant.count()).toBe(before);
  });

  it("does nothing, and says why, when the server has no provisioning account", async () => {
    // Independiente del entorno de quien corre las pruebas: un servidor sin la variable no puede dar de alta nada.
    const saved = process.env.TENANT_PROVISIONING_URL;
    vi.stubEnv("TENANT_PROVISIONING_URL", "");
    try {
      expect(() => provisioningConfig({}, {})).toThrow(ProvisioningUnavailableError);
      const before = await controlTestDb.tenant.count();
      await expect(
        startProvisioning(input(), context, { config: { templateDb: TEMPLATE } }),
      ).rejects.toBeInstanceOf(ProvisioningUnavailableError);
      expect(await controlTestDb.tenant.count()).toBe(before);
    } finally {
      vi.stubEnv("TENANT_PROVISIONING_URL", saved ?? "");
    }
  });

  it("stops with a clear reason if the template is missing", async () => {
    const data = input();
    const outcome = await startProvisioning(data, context, {
      config: { adminUrl, templateDb: "rt3_no_existe" },
    });
    expect(outcome).toMatchObject({ status: "FAILED", step: "validate" });
    expect((outcome as { error: string }).error).toContain("pnpm tenants:template");
    expect((await tenantRow(data.slug)).status).toBe("FAILED");
    await undoProvisioning(data.slug, context, { config });
  });
});

describe("registering a business with a plan", () => {
  const planData = (name: string, trialDays = 10) => ({
    name,
    description: null,
    priceCents: 90_000,
    interval: "MONTHLY" as const,
    limits: { users: 5, products: null, terminals: null, locations: null },
    features: ["reports"],
    trialDays,
    sortOrder: 1,
  });

  it("starts the business on a trial of that plan, in the same transaction that activates it", async () => {
    const { id: planId } = await createPlan(planData("Con prueba"), context, {
      client: controlTestDb,
    });
    const data = input();
    const before = Date.now();
    expect(await startProvisioning({ ...data, planId }, context, { config })).toMatchObject({
      status: "SUCCEEDED",
    });

    const tenant = await tenantRow(data.slug);
    const subscription = await controlTestDb.subscription.findFirstOrThrow({
      where: { tenantId: tenant.id },
    });
    expect(subscription).toMatchObject({ planId, isTrial: true, status: "TRIAL" });
    const trialMs = subscription.currentPeriodEnd.getTime() - before;
    expect(trialMs).toBeGreaterThan(10 * 24 * 3_600_000 - 120_000);
    expect(trialMs).toBeLessThan(10 * 24 * 3_600_000 + 120_000);

    const audit = await controlTestDb.platformAuditLog.findMany({
      where: { tenantId: tenant.id },
      orderBy: { at: "asc" },
    });
    expect(audit.map((row) => row.action)).toEqual([
      "TENANT_PROVISION_STARTED",
      "SUBSCRIPTION_ASSIGNED",
      "TENANT_PROVISIONED",
    ]);

    // El directorio ya entrega el plan al atender sus peticiones.
    const entry = await directory.lookupByHost(`${data.slug}.localhost`);
    expect(entry).toMatchObject({
      state: "active",
      tenant: {
        entitlements: {
          planName: "Con prueba",
          features: ["reports"],
          limits: { users: 5 },
          mode: "full",
          status: "TRIAL",
        },
      },
    });
  }, 120_000);

  it("without a plan the business gets no subscription and is not restricted", async () => {
    const data = input();
    await startProvisioning(data, context, { config });
    const tenant = await tenantRow(data.slug);
    expect(await controlTestDb.subscription.count({ where: { tenantId: tenant.id } })).toBe(0);
    const entry = await directory.lookupByHost(`${data.slug}.localhost`);
    expect(entry && "tenant" in entry && "entitlements" in entry.tenant).toBe(false);
  }, 120_000);

  it("refuses an unknown or deactivated plan before creating anything", async () => {
    const { id: planId } = await createPlan(planData("Retirado"), context, {
      client: controlTestDb,
    });
    await setPlanActive(planId, false, context, { client: controlTestDb });
    const before = await controlTestDb.tenant.count();
    await expect(
      startProvisioning({ ...input(), planId }, context, { config }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      startProvisioning({ ...input(), planId: "no-existe" }, context, { config }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await controlTestDb.tenant.count()).toBe(before);
  });

  it("keeps the chosen plan when the recipe fails and is resumed later", async () => {
    const { id: planId } = await createPlan(planData("Sobrevive"), context, {
      client: controlTestDb,
    });
    const data = input();
    const failed = await startProvisioning({ ...data, planId }, context, {
      config: { adminUrl, templateDb: "rt3_no_existe" },
    });
    expect(failed).toMatchObject({ status: "FAILED" });
    const tenant = await tenantRow(data.slug);
    expect(await controlTestDb.subscription.count({ where: { tenantId: tenant.id } })).toBe(0);

    expect(await resumeProvisioning(data.slug, context, { config })).toMatchObject({
      status: "SUCCEEDED",
    });
    expect(
      await controlTestDb.subscription.findFirstOrThrow({ where: { tenantId: tenant.id } }),
    ).toMatchObject({ planId, isTrial: true });
  }, 120_000);
});

describe("a failed step stops the recipe; retrying continues from there", () => {
  it("records the failure without leaking connection strings, then resumes without redoing what was done", async () => {
    const data = input();
    let failures = 0;
    const flaky = {
      config,
      hooks: {
        beforeStep: (step: ProvisionStepName) => {
          if (step === "owner" && failures === 0) {
            failures += 1;
            throw new Error("no se pudo conectar postgresql://admin:S3cr3tPass@db:5432/x");
          }
        },
      },
    };
    const first = await startProvisioning(data, context, flaky);
    expect(first).toMatchObject({ status: "FAILED", step: "owner" });
    expect((first as { error: string }).error).not.toContain("S3cr3tPass");

    const tenant = await tenantRow(data.slug);
    expect(tenant.status).toBe("FAILED");
    const [failed] = await runsOf(data.slug);
    expect(failed).toMatchObject({ status: "FAILED", attempt: 1 });
    expect(JSON.stringify(failed)).not.toContain("S3cr3tPass");
    expect(stepsOf(failed!).map((step) => step.status)).toEqual([
      "DONE",
      "DONE",
      "DONE",
      "DONE",
      "DONE",
      "FAILED",
      "PENDING",
    ]);
    // Lo ya hecho sigue ahí: la base existe con el mismo identificador antes y después de reintentar.
    const oidBefore = await databaseOid(tenant.dbName!);
    expect(oidBefore).toBeDefined();

    const resumed = await resumeProvisioning(data.slug, context, flaky);
    expect(resumed).toMatchObject({ status: "SUCCEEDED" });
    expect(await databaseOid(tenant.dbName!)).toBe(oidBefore);

    const after = await tenantRow(data.slug);
    expect(after.status).toBe("ACTIVE");
    expect(after.dbCredentialEnc).toBe(tenant.dbCredentialEnc); // la misma contraseña de la base
    const [run] = await runsOf(data.slug);
    expect(run).toMatchObject({ status: "SUCCEEDED", attempt: 2, secretEnc: null });
    const entry = await directory.lookupByHost(`${data.slug}.localhost`);
    const session = await runWithTenant(
      (entry as { state: "active"; tenant: { id: string; databaseUrl: string } }).tenant,
      () => login({ username: "rosa", password: OWNER_PASSWORD, ip: "10.0.0.3" }),
    );
    expect(session.token).toBeTruthy();

    const actions = (
      await controlTestDb.platformAuditLog.findMany({
        where: { tenantId: tenant.id },
        orderBy: { at: "asc" },
      })
    ).map((row) => row.action);
    expect(actions).toEqual([
      "TENANT_PROVISION_STARTED",
      "TENANT_PROVISION_FAILED",
      "TENANT_PROVISION_RESUMED",
      "TENANT_PROVISIONED",
    ]);
  }, 120_000);

  it("only one of two simultaneous retries gets the recipe", async () => {
    const data = input();
    let failures = 0;
    const flaky = {
      config,
      hooks: {
        beforeStep: (step: ProvisionStepName) => {
          if (step === "seed" && failures === 0) {
            failures += 1;
            throw new Error("fallo inyectado");
          }
        },
      },
    };
    expect(await startProvisioning(data, context, flaky)).toMatchObject({ status: "FAILED" });
    const results = await Promise.allSettled([
      resumeProvisioning(data.slug, context, flaky),
      resumeProvisioning(data.slug, context, flaky),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
    expect((await tenantRow(data.slug)).status).toBe("ACTIVE");
  }, 120_000);

  it("a recipe that is running (alive) cannot be taken over, but one without signs of life can", async () => {
    const data = input();
    const failOnce = {
      config,
      hooks: {
        beforeStep: (step: ProvisionStepName) => {
          if (step === "owner") {
            throw new Error("fallo inyectado");
          }
        },
      },
    };
    await startProvisioning(data, context, failOnce);
    const tenant = await tenantRow(data.slug);
    // La dejamos «en marcha» con signos de vida recientes: otro proceso la está trabajando.
    await controlTestDb.provisioningRun.updateMany({
      where: { tenantId: tenant.id },
      data: { status: "RUNNING", heartbeatAt: new Date() },
    });
    await expect(resumeProvisioning(data.slug, context, { config })).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(undoProvisioning(data.slug, context, { config })).rejects.toBeInstanceOf(
      ConflictError,
    );
    // Sin signos de vida por más de 5 minutos: se considera interrumpida y se puede retomar.
    await controlTestDb.provisioningRun.updateMany({
      where: { tenantId: tenant.id },
      data: { heartbeatAt: new Date(Date.now() - 6 * 60_000) },
    });
    expect(await resumeProvisioning(data.slug, context, { config })).toMatchObject({
      status: "SUCCEEDED",
    });
  }, 120_000);
});

describe("undoing leaves no residue", () => {
  it("drops the database and the role of the attempt, keeps the record as FAILED and frees the subdomain", async () => {
    const data = input();
    const outcome = await startProvisioning(data, context, {
      config,
      hooks: {
        beforeStep: (step) => {
          if (step === "seed") {
            throw new Error("fallo inyectado");
          }
        },
      },
    });
    expect(outcome).toMatchObject({ status: "FAILED", step: "seed" });
    const tenant = await tenantRow(data.slug);
    expect(await databaseExists(adminUrl, tenant.dbName!)).toBe(true);
    expect(await roleExists(adminUrl, tenant.dbRole!)).toBe(true);

    await undoProvisioning(data.slug, context, { config });
    expect(await databaseExists(adminUrl, tenant.dbName!)).toBe(false);
    expect(await roleExists(adminUrl, tenant.dbRole!)).toBe(false);
    const undone = await tenantRow(data.slug);
    expect(undone).toMatchObject({
      status: "FAILED",
      dbCredentialEnc: null,
      schemaVersion: null,
    });
    expect((await runsOf(data.slug))[0]).toMatchObject({ status: "UNDONE", secretEnc: null });
    // Un negocio que no terminó de crearse nunca se atiende.
    expect(await directory.lookupByHost(`${data.slug}.localhost`)).toBeUndefined();
    // No se puede deshacer dos veces.
    await expect(undoProvisioning(data.slug, context, { config })).rejects.toBeInstanceOf(
      ConflictError,
    );

    // El subdominio se puede registrar de nuevo, con otros datos: reutiliza el registro y arranca limpio.
    const again = await startProvisioning(
      { ...data, name: "Nombre corregido", ownerUsername: "otra" },
      context,
      { config },
    );
    expect(again).toMatchObject({ status: "SUCCEEDED" });
    const reborn = await tenantRow(data.slug);
    expect(reborn).toMatchObject({ id: tenant.id, status: "ACTIVE", name: "Nombre corregido" });
    expect((await runsOf(data.slug)).map((run) => [run.attempt, run.status])).toEqual([
      [1, "UNDONE"],
      [2, "SUCCEEDED"],
    ]);
  }, 120_000);

  it("never undoes a business that is already registered", async () => {
    const data = input();
    await startProvisioning(data, context, { config });
    await expect(undoProvisioning(data.slug, context, { config })).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(undoProvisioning("no-existe", context, { config })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect((await tenantRow(data.slug)).status).toBe("ACTIVE");
  }, 120_000);
});

describe("the process dies in the middle", () => {
  it("is killed for real after the seed step, and the recipe resumes from the next step", async () => {
    const slug = `matado-${Date.now().toString(36)}`;
    const env = {
      ...process.env,
      CONTROL_DATABASE_URL: controlTestUrl(),
      PLATFORM_MASTER_KEY: TEST_MASTER_KEY,
      TENANT_PROVISIONING_URL: adminUrl,
      TENANT_TEMPLATE_DB: TEMPLATE,
      PROVISION_SLUG: slug,
      PROVISION_DIE_AFTER: "seed",
      PROVISION_OWNER_PASSWORD: OWNER_PASSWORD,
    };
    const child = spawnSync(
      "pnpm",
      ["exec", "tsx", "tests/integration/helpers/provision-and-die.ts"],
      {
        env,
        shell: true,
        encoding: "utf8",
        timeout: 120_000,
      },
    );
    // El proceso no llegó al final (lo mataron): no imprimió que la receta terminó.
    expect(child.stdout).not.toContain("la receta terminó completa");

    // La base central quedó con una receta «en marcha» que nadie atiende, a medias.
    const tenant = await tenantRow(slug);
    expect(tenant.status).toBe("PROVISIONING");
    const [run] = await runsOf(slug);
    expect(run?.status).toBe("RUNNING");
    expect(stepsOf(run!).map((step) => step.status)).toEqual([
      "DONE",
      "DONE",
      "DONE",
      "DONE",
      "DONE",
      "PENDING",
      "PENDING",
    ]);
    expect(await databaseExists(adminUrl, tenant.dbName!)).toBe(true);
    const oid = await databaseOid(tenant.dbName!);

    // Con signos de vida recientes no se puede retomar a la fuerza…
    await expect(resumeProvisioning(slug, context, { config })).rejects.toBeInstanceOf(
      ConflictError,
    );
    // …pero pasados los minutos de gracia (aquí, sin espera) sí: continúa con el propietario y termina.
    const resumed = await resumeProvisioning(slug, context, { config, staleAfterMs: 0 });
    expect(resumed).toMatchObject({ status: "SUCCEEDED" });
    expect(await databaseOid(tenant.dbName!)).toBe(oid);
    const entry = await directory.lookupByHost(`${slug}.localhost`);
    const session = await runWithTenant(
      (entry as { state: "active"; tenant: { id: string; databaseUrl: string } }).tenant,
      () => login({ username: "duena", password: OWNER_PASSWORD, ip: "10.0.0.4" }),
    );
    expect(session.token).toBeTruthy();
    await withClient(adminUrlFor(adminUrl, tenant.dbName!), async (client) => {
      expect(await client.user.count({ where: { role: "OWNER" } })).toBe(1);
      expect(await client.location.count()).toBe(1);
    });
  }, 240_000);
});

describe("many businesses at once", () => {
  it("registers 20 businesses, five at a time, each in its own database and role, none able to see another", async () => {
    const started = Date.now();
    const slugs = Array.from({ length: 20 }, (_, index) => `lote-${index + 1}`);
    for (let offset = 0; offset < slugs.length; offset += 5) {
      const outcomes = await Promise.all(
        slugs
          .slice(offset, offset + 5)
          .map((slug) =>
            startProvisioning(
              input({ slug, name: `Lote ${slug}`, ownerUsername: "dueno" }),
              context,
              { config },
            ),
          ),
      );
      for (const outcome of outcomes) {
        expect(outcome).toMatchObject({ status: "SUCCEEDED" });
      }
    }
    console.log(`20 negocios dados de alta en ${Math.round((Date.now() - started) / 1000)} s`);

    const tenants = await controlTestDb.tenant.findMany({ where: { slug: { in: slugs } } });
    expect(tenants).toHaveLength(20);
    expect(new Set(tenants.map((tenant) => tenant.dbName)).size).toBe(20);
    expect(tenants.every((tenant) => tenant.status === "ACTIVE")).toBe(true);
    for (const tenant of tenants) {
      expect(await databaseExists(adminUrl, tenant.dbName!)).toBe(true);
      expect(await roleExists(adminUrl, tenant.dbRole!)).toBe(true);
    }

    // Cada uno ve solo su base (el nombre del negocio es lo único distinto) y su rol no entra a la de otro.
    const sample = tenants.slice(0, 6);
    for (const [index, tenant] of sample.entries()) {
      const password = getVault().decrypt(
        tenant.dbCredentialEnc as string,
        vaultContext.tenantDatabase(tenant.id),
      );
      const own = urlFor(adminUrl, { database: tenant.dbName!, user: tenant.dbRole!, password });
      await withClient(own, async (client) => {
        expect((await client.businessProfile.findFirstOrThrow()).legalName).toBe(
          `Lote ${tenant.slug}`,
        );
      });
      const other = sample[(index + 1) % sample.length]!;
      await expect(
        withClient(
          urlFor(adminUrl, { database: other.dbName!, user: tenant.dbRole!, password }),
          (client) => client.$queryRaw`select 1`,
        ),
      ).rejects.toThrow();
    }
  }, 600_000);
});
