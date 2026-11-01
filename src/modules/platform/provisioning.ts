import type { Prisma } from "@/generated/control/client";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { controlDb, type ControlDb } from "@/lib/tenancy/control-db";
import { invalidateTenantDirectory } from "@/lib/tenancy/control-directory";
import { assertIdentifier, randomPassword, withClient } from "@/lib/tenancy/provision-db";
import {
  adminUrlFor,
  applyTenantGrants,
  databaseExists,
  dropTenantResources,
  ensureMigrated,
  ensureTenantDatabase,
  ensureTenantRole,
  readSchemaVersion,
} from "@/lib/tenancy/provision-steps";
import { isReservedSlug, isValidSlug } from "@/lib/tenancy/slug";
import { getVault, vaultContext, type Vault } from "@/lib/tenancy/vault";
import { recordPlatformAudit } from "@/modules/platform/audit";
import type { AdminContext } from "@/modules/platform/service";
import { startSubscription } from "@/modules/platform/subscription-start";

/**
 * Alta automática de un negocio (propuesta SaaS §4): una **receta de pasos idempotentes** que deja anotado cada paso en
 * `ProvisioningRun`. Si un paso falla (o el proceso muere a la mitad) la receta queda detenida con su motivo; **reintentar**
 * continúa desde el paso que falló y **deshacer** quita lo que creó el intento (base y rol) sin dejar residuos.
 *
 * Los pasos, en orden:
 * 1. `validate`  la cuenta de aprovisionamiento y la plantilla existen.
 * 2. `role`      el rol de aplicación del negocio, con una contraseña aleatoria que se guarda cifrada en la bóveda.
 * 3. `database`  la base se copia de la plantilla y queda accesible solo para su rol.
 * 4. `migrate`   se aplican las migraciones que falten y los permisos de datos del rol.
 * 5. `seed`      ubicación, caja, catálogos, ajustes y el nombre del negocio.
 * 6. `owner`     el propietario inicial, con la contraseña temporal que dio quien hace el alta.
 * 7. `finalize`  el negocio pasa a `ACTIVE` y se borra la contraseña temporal de la receta.
 */

export const PROVISION_STEPS = [
  "validate",
  "role",
  "database",
  "migrate",
  "seed",
  "owner",
  "finalize",
] as const;
export type ProvisionStepName = (typeof PROVISION_STEPS)[number];

export type StepState = {
  name: ProvisionStepName;
  status: "PENDING" | "DONE" | "FAILED";
  startedAt?: string;
  finishedAt?: string;
  error?: string;
};

/** La plataforma no tiene configurada la cuenta con la que se crean bases: no se puede dar de alta nada. */
export class ProvisioningUnavailableError extends ConflictError {}

export type ProvisioningConfig = { adminUrl: string; templateDb: string };

export const DEFAULT_TEMPLATE_DB = "boutique_plantilla";

type EnvSource = Record<string, string | undefined>;

export function provisioningConfig(
  overrides: Partial<ProvisioningConfig> = {},
  env: EnvSource = process.env,
): ProvisioningConfig {
  // Una variable vacía (como la deja un compose sin valor) cuenta como no definida.
  const adminUrl = overrides.adminUrl || env.TENANT_PROVISIONING_URL;
  if (!adminUrl) {
    throw new ProvisioningUnavailableError(
      "El alta de negocios no está configurada en este servidor (falta TENANT_PROVISIONING_URL)",
    );
  }
  return {
    adminUrl,
    templateDb: assertIdentifier(
      overrides.templateDb || env.TENANT_TEMPLATE_DB || DEFAULT_TEMPLATE_DB,
    ),
  };
}

export function provisioningAvailable(env: EnvSource = process.env): boolean {
  return Boolean(env.TENANT_PROVISIONING_URL);
}

export type ProvisioningDeps = {
  client?: ControlDb;
  vault?: Vault;
  config?: Partial<ProvisioningConfig>;
  now?: () => Date;
  /** Cómo se aplican las migraciones a una base (para pruebas). */
  migrate?: (databaseUrl: string) => Promise<void>;
  /** Solo pruebas: se llama antes y después de cada paso (p. ej. para matar el proceso a la mitad). */
  hooks?: {
    beforeStep?: (step: ProvisionStepName, runId: string) => void | Promise<void>;
    afterStep?: (step: ProvisionStepName, runId: string) => void | Promise<void>;
  };
  /** Cuánto sin signos de vida antes de considerar interrumpida una receta «en marcha». */
  staleAfterMs?: number;
};

export const DEFAULT_STALE_AFTER_MS = 5 * 60_000;

type Resolved = {
  client: ControlDb;
  vault: Vault;
  config: ProvisioningConfig;
  now: () => Date;
  migrate: ProvisioningDeps["migrate"];
  hooks: NonNullable<ProvisioningDeps["hooks"]>;
  staleAfterMs: number;
};

function resolve(deps: ProvisioningDeps): Resolved {
  return {
    client: deps.client ?? controlDb,
    vault: deps.vault ?? getVault(),
    config: provisioningConfig(deps.config),
    now: deps.now ?? (() => new Date()),
    migrate: deps.migrate,
    hooks: deps.hooks ?? {},
    staleAfterMs: deps.staleAfterMs ?? DEFAULT_STALE_AFTER_MS,
  };
}

// ───────────────────────────── Datos de entrada ─────────────────────────────

export type ProvisionInput = {
  slug: string;
  name: string;
  ownerName: string;
  ownerUsername: string;
  /** Contraseña temporal del propietario inicial: la entrega quien hace el alta y la persona la cambia al entrar. */
  ownerPassword: string;
  ownerEmail?: string | undefined;
  /** Plan con el que empieza (en prueba). Sin plan, el negocio se atiende sin restricciones hasta que se le asigne uno. */
  planId?: string | undefined;
};

export type ProvisionData = Required<Omit<ProvisionInput, "ownerEmail" | "planId">> & {
  ownerEmail: string | null;
};

const OWNER_USERNAME = /^[a-z0-9._-]{3,30}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseProvisionInput(input: ProvisionInput): ProvisionData {
  const slug = input.slug.trim().toLowerCase();
  const name = input.name.trim();
  const ownerName = input.ownerName.trim();
  const ownerUsername = input.ownerUsername.trim().toLowerCase();
  const ownerEmail = input.ownerEmail?.trim() || null;
  if (!isValidSlug(slug)) {
    throw new ValidationError(
      "El subdominio solo puede tener letras minúsculas, números y guiones (hasta 40 caracteres)",
    );
  }
  if (isReservedSlug(slug)) {
    throw new ValidationError(`El subdominio "${slug}" está reservado: elige otro`);
  }
  if (name.length < 2 || name.length > 120) {
    throw new ValidationError("El nombre del negocio debe tener entre 2 y 120 caracteres");
  }
  if (ownerName.length < 2 || ownerName.length > 80) {
    throw new ValidationError("El nombre del propietario debe tener entre 2 y 80 caracteres");
  }
  if (!OWNER_USERNAME.test(ownerUsername)) {
    throw new ValidationError(
      "El usuario del propietario solo puede tener letras minúsculas, números, punto, guion y guion bajo (3 a 30)",
    );
  }
  if (input.ownerPassword.length < 8 || input.ownerPassword.length > 128) {
    throw new ValidationError("La contraseña temporal debe tener entre 8 y 128 caracteres");
  }
  if (ownerEmail && !EMAIL.test(ownerEmail)) {
    throw new ValidationError("El correo del propietario no parece válido");
  }
  return {
    slug,
    name,
    ownerName,
    ownerUsername,
    ownerPassword: input.ownerPassword,
    ownerEmail,
  };
}

// ───────────────────────────── Utilidades ─────────────────────────────

const iso = (date: Date) => date.toISOString();

/** Lo que se guarda como motivo de un fallo: corto y sin cadenas de conexión (podrían llevar una contraseña). */
export function describeFailure(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/postgres(ql)?:\/\/[^\s@]*@/gi, "postgresql://***@").slice(0, 800);
}

function freshSteps(): StepState[] {
  return PROVISION_STEPS.map((name) => ({ name, status: "PENDING" }));
}

async function saveSteps(
  { client, now }: Resolved,
  runId: string,
  steps: StepState[],
  extra: Prisma.ProvisioningRunUpdateInput = {},
): Promise<void> {
  await client.provisioningRun.update({
    where: { id: runId },
    data: { steps: steps as unknown as Prisma.InputJsonValue, heartbeatAt: now(), ...extra },
  });
}

type RunWithTenant = Prisma.ProvisioningRunGetPayload<{ include: { tenant: true } }>;

// ───────────────────────────── Los pasos ─────────────────────────────

type StepContext = { run: RunWithTenant; deps: Resolved; admin: AdminContext };

function tenantDatabaseOf(run: RunWithTenant): { database: string; role: string } {
  const { dbName, dbRole } = run.tenant;
  if (!dbName || !dbRole) {
    throw new Error("El negocio no tiene nombre de base o de rol asignado");
  }
  return { database: dbName, role: dbRole };
}

const STEPS: Record<ProvisionStepName, (context: StepContext) => Promise<void>> = {
  async validate({ deps }) {
    const { adminUrl, templateDb } = deps.config;
    if (!(await databaseExists(adminUrl, templateDb))) {
      throw new Error(
        `Falta la base plantilla «${templateDb}»: prepárala con «pnpm tenants:template»`,
      );
    }
  },

  async role({ run, deps }) {
    const { role } = tenantDatabaseOf(run);
    const context = vaultContext.tenantDatabase(run.tenant.id);
    let password: string;
    if (run.tenant.dbCredentialEnc) {
      password = deps.vault.decrypt(run.tenant.dbCredentialEnc, context);
    } else {
      // La contraseña se guarda **antes** de crear el rol: si el proceso muere entre una cosa y otra, se retoma con la misma.
      password = randomPassword();
      await deps.client.tenant.update({
        where: { id: run.tenant.id },
        data: { dbCredentialEnc: deps.vault.encrypt(password, context) },
      });
    }
    await ensureTenantRole(deps.config.adminUrl, { role, password });
  },

  async database({ run, deps }) {
    const { database, role } = tenantDatabaseOf(run);
    await ensureTenantDatabase(deps.config.adminUrl, {
      database,
      role,
      template: deps.config.templateDb,
    });
  },

  async migrate({ run, deps }) {
    const { database, role } = tenantDatabaseOf(run);
    const version = await ensureMigrated(adminUrlFor(deps.config.adminUrl, database), {
      ...(deps.migrate ? { migrate: deps.migrate } : {}),
    });
    await applyTenantGrants(deps.config.adminUrl, { database, role });
    await deps.client.tenant.update({
      where: { id: run.tenant.id },
      data: { schemaVersion: version },
    });
  },

  async seed({ run, deps }) {
    const { database } = tenantDatabaseOf(run);
    // La semilla y el propietario son datos del negocio: se cargan con la cuenta de aprovisionamiento, directo a su base.
    const { seedBase } = await import("../../../prisma/seed/run-seed");
    await withClient(adminUrlFor(deps.config.adminUrl, database), async (client) => {
      await seedBase(client);
      await client.businessProfile.updateMany({ data: { legalName: run.tenant.name } });
    });
  },

  async owner({ run, deps }) {
    const { database } = tenantDatabaseOf(run);
    const { createFirstOwner } = await import("@/modules/users/bootstrap");
    await withClient(adminUrlFor(deps.config.adminUrl, database), async (client) => {
      if ((await client.user.count({ where: { role: "OWNER", isActive: true } })) > 0) {
        return; // ya se creó en un intento anterior
      }
      if (!run.secretEnc) {
        throw new Error("Falta la contraseña temporal del propietario: repite el alta");
      }
      const password = deps.vault.decrypt(
        run.secretEnc,
        vaultContext.tenantOwnerPassword(run.tenant.id),
      );
      await createFirstOwner(
        { name: run.ownerName, username: run.ownerUsername, password },
        client,
      );
    });
  },

  async finalize({ run, deps, admin }) {
    const { database } = tenantDatabaseOf(run);
    const version = await readSchemaVersion(adminUrlFor(deps.config.adminUrl, database));
    await deps.client.$transaction(async (tx) => {
      await tx.tenant.update({
        where: { id: run.tenant.id },
        data: { status: "ACTIVE", schemaVersion: version, dbServerId: "primary" },
      });
      await tx.provisioningRun.update({
        where: { id: run.id },
        data: { status: "SUCCEEDED", secretEnc: null, error: null, finishedAt: deps.now() },
      });
      // El plan elegido en el alta arranca en prueba, en la misma transacción (y solo si no hay suscripción: el paso es repetible).
      if (run.planId) {
        const plan = await tx.plan.findUnique({ where: { id: run.planId } });
        const already = await tx.subscription.findFirst({
          where: { tenantId: run.tenant.id, status: { not: "EXPIRED" } },
          select: { id: true },
        });
        if (plan && !already) {
          const sub = await startSubscription(tx, {
            tenantId: run.tenant.id,
            plan,
            trial: true,
            now: deps.now(),
            reason: "Plan elegido al dar de alta el negocio",
          });
          await recordPlatformAudit(tx, {
            action: "SUBSCRIPTION_ASSIGNED",
            actor: admin.actor,
            tenantId: run.tenant.id,
            targetType: "Subscription",
            targetId: sub.id,
            details: {
              slug: run.tenant.slug,
              plan: plan.name,
              trial: true,
              periodEnd: sub.currentPeriodEnd.toISOString(),
            },
            ip: admin.ip,
          });
        }
      }
      // En la misma transacción que deja el negocio activo: no puede haber un negocio activo sin su registro.
      await recordPlatformAudit(tx, {
        action: "TENANT_PROVISIONED",
        actor: admin.actor,
        tenantId: run.tenant.id,
        targetType: "Tenant",
        targetId: run.tenant.id,
        details: { slug: run.tenant.slug, name: run.tenant.name, database, attempt: run.attempt },
        ip: admin.ip,
      });
    });
    invalidateTenantDirectory();
  },
};

// ───────────────────────────── La ejecución ─────────────────────────────

export type ProvisionOutcome =
  | { status: "SUCCEEDED"; tenantId: string; runId: string; slug: string }
  | {
      status: "FAILED";
      tenantId: string;
      runId: string;
      slug: string;
      step: ProvisionStepName;
      error: string;
    };

async function failRun(
  deps: Resolved,
  run: RunWithTenant,
  steps: StepState[],
  step: StepState,
  error: unknown,
  context: AdminContext,
): Promise<ProvisionOutcome> {
  const message = describeFailure(error);
  step.status = "FAILED";
  step.error = message;
  step.finishedAt = iso(deps.now());
  await deps.client.$transaction(async (tx) => {
    await tx.provisioningRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        error: message,
        steps: steps as unknown as Prisma.InputJsonValue,
        heartbeatAt: deps.now(),
      },
    });
    await tx.tenant.update({ where: { id: run.tenant.id }, data: { status: "FAILED" } });
    await recordPlatformAudit(tx, {
      action: "TENANT_PROVISION_FAILED",
      actor: context.actor,
      tenantId: run.tenant.id,
      targetType: "Tenant",
      targetId: run.tenant.id,
      details: { slug: run.tenant.slug, step: step.name, attempt: run.attempt, error: message },
      ip: context.ip,
    });
  });
  return {
    status: "FAILED",
    tenantId: run.tenant.id,
    runId: run.id,
    slug: run.tenant.slug,
    step: step.name,
    error: message,
  };
}

/** Corre los pasos que faltan de una receta que ya es de quien llama. */
async function executeRun(
  deps: Resolved,
  runId: string,
  context: AdminContext,
): Promise<ProvisionOutcome> {
  for (;;) {
    const run = await deps.client.provisioningRun.findUniqueOrThrow({
      where: { id: runId },
      include: { tenant: true },
    });
    const steps = run.steps as unknown as StepState[];
    const step = steps.find((candidate) => candidate.status !== "DONE");
    if (!step) {
      return {
        status: "SUCCEEDED",
        tenantId: run.tenant.id,
        runId: run.id,
        slug: run.tenant.slug,
      };
    }
    step.status = "PENDING";
    step.startedAt = iso(deps.now());
    delete step.error;
    await saveSteps(deps, runId, steps);
    try {
      // Un fallo del gancho de pruebas cuenta como un fallo del paso.
      await deps.hooks.beforeStep?.(step.name, runId);
      await STEPS[step.name]({ run, deps, admin: context });
    } catch (error) {
      return failRun(deps, run, steps, step, error, context);
    }
    step.status = "DONE";
    step.finishedAt = iso(deps.now());
    await saveSteps(deps, runId, steps);
    await deps.hooks.afterStep?.(step.name, runId);
  }
}

// ───────────────────────────── Operaciones ─────────────────────────────

/**
 * Da de alta un negocio nuevo de principio a fin. Devuelve cómo terminó: `SUCCEEDED`, o `FAILED` con el paso y el motivo
 * (la receta queda detenida: se puede reintentar o deshacer). Solo lanza si lo pedido no es válido o ya existe.
 */
export async function startProvisioning(
  input: ProvisionInput,
  context: AdminContext,
  deps: ProvisioningDeps = {},
): Promise<ProvisionOutcome> {
  const resolved = resolve(deps);
  const data = parseProvisionInput(input);
  const { client, vault, now } = resolved;
  const planId = input.planId?.trim() || null;

  const runId = await client.$transaction(async (tx) => {
    if (planId) {
      const plan = await tx.plan.findUnique({ where: { id: planId } });
      if (!plan) {
        throw new NotFoundError("No existe ese plan");
      }
      if (!plan.isActive) {
        throw new ConflictError("Ese plan está desactivado: actívalo o elige otro");
      }
    }
    const existing = await tx.tenant.findUnique({
      where: { slug: data.slug },
      include: { provisioningRuns: { orderBy: { startedAt: "desc" }, take: 1 } },
    });
    let tenantId: string;
    let attempt = 1;
    if (existing) {
      // Solo se puede volver a usar el subdominio de un alta que falló y se deshizo.
      const last = existing.provisioningRuns[0];
      if (existing.status !== "FAILED" || last?.status !== "UNDONE") {
        throw new ConflictError(
          existing.status === "FAILED"
            ? `El alta anterior de "${data.slug}" quedó a medias: retómala o deshazla antes de registrarlo de nuevo`
            : `Ya existe un negocio con el subdominio "${data.slug}"`,
        );
      }
      tenantId = existing.id;
      attempt = (await tx.provisioningRun.count({ where: { tenantId } })) + 1;
      await tx.tenant.update({
        where: { id: tenantId },
        data: { name: data.name, ownerEmail: data.ownerEmail, status: "PROVISIONING" },
      });
    } else {
      const created = await tx.tenant.create({
        data: {
          slug: data.slug,
          name: data.name,
          ownerEmail: data.ownerEmail,
          status: "PROVISIONING",
        },
        select: { id: true },
      });
      tenantId = created.id;
      // Los nombres de la base y del rol los genera el sistema a partir del id: nadie los escribe.
      const name = assertIdentifier(`t_${tenantId}`);
      await tx.tenant.update({ where: { id: tenantId }, data: { dbName: name, dbRole: name } });
    }
    const run = await tx.provisioningRun.create({
      data: {
        tenantId,
        attempt,
        steps: freshSteps() as unknown as Prisma.InputJsonValue,
        ownerName: data.ownerName,
        ownerUsername: data.ownerUsername,
        ownerEmail: data.ownerEmail,
        planId,
        secretEnc: vault.encrypt(data.ownerPassword, vaultContext.tenantOwnerPassword(tenantId)),
        actorId: context.actor?.id ?? null,
        actorUsername: context.actor?.username ?? null,
        heartbeatAt: now(),
      },
      select: { id: true },
    });
    await recordPlatformAudit(tx, {
      action: "TENANT_PROVISION_STARTED",
      actor: context.actor,
      tenantId,
      targetType: "Tenant",
      targetId: tenantId,
      details: { slug: data.slug, name: data.name, ownerUsername: data.ownerUsername, planId },
      ip: context.ip,
    });
    return run.id;
  });

  return executeRun(resolved, runId, context);
}

async function latestRun(client: ControlDb, tenantId: string) {
  return client.provisioningRun.findFirst({
    where: { tenantId },
    orderBy: { startedAt: "desc" },
    include: { tenant: true },
  });
}

async function tenantBySlug(client: ControlDb, slug: string) {
  const tenant = await client.tenant.findUnique({ where: { slug } });
  if (!tenant) {
    throw new NotFoundError("No existe ese negocio");
  }
  return tenant;
}

/**
 * Toma la receta para trabajarla: solo si falló o si lleva demasiado sin signos de vida (el proceso que la corría murió).
 * Es atómico: dos personas (o dos procesos) que intentan retomarla a la vez, solo una la obtiene.
 */
async function claimRun(deps: Resolved, runId: string, bumpAttempt: boolean): Promise<boolean> {
  const staleBefore = new Date(deps.now().getTime() - deps.staleAfterMs);
  const claimed = await deps.client.provisioningRun.updateMany({
    where: {
      id: runId,
      OR: [{ status: "FAILED" }, { status: "RUNNING", heartbeatAt: { lt: staleBefore } }],
    },
    data: {
      status: "RUNNING",
      heartbeatAt: deps.now(),
      error: null,
      ...(bumpAttempt ? { attempt: { increment: 1 } } : {}),
    },
  });
  return claimed.count === 1;
}

/** Retoma un alta que falló o se interrumpió, desde el paso que quedó pendiente. */
export async function resumeProvisioning(
  slug: string,
  context: AdminContext,
  deps: ProvisioningDeps = {},
): Promise<ProvisionOutcome> {
  const resolved = resolve(deps);
  const tenant = await tenantBySlug(resolved.client, slug);
  const run = await latestRun(resolved.client, tenant.id);
  if (!run) {
    throw new ConflictError("Ese negocio no tiene un alta que retomar");
  }
  if (run.status === "SUCCEEDED") {
    throw new ConflictError("El alta de ese negocio ya terminó");
  }
  if (run.status === "UNDONE") {
    throw new ConflictError("El alta se deshizo: registra el negocio de nuevo");
  }
  if (!(await claimRun(resolved, run.id, true))) {
    throw new ConflictError("El alta sigue en marcha: espera unos minutos antes de retomarla");
  }
  await resolved.client.tenant.update({
    where: { id: tenant.id },
    data: { status: "PROVISIONING" },
  });
  await recordPlatformAudit(resolved.client, {
    action: "TENANT_PROVISION_RESUMED",
    actor: context.actor,
    tenantId: tenant.id,
    targetType: "Tenant",
    targetId: tenant.id,
    details: { slug: tenant.slug, attempt: run.attempt + 1 },
    ip: context.ip,
  });
  return executeRun(resolved, run.id, context);
}

/**
 * Deshace un alta que no terminó: borra la base y el rol que creó el intento y deja el negocio en `FAILED`, sin residuos
 * (el subdominio se puede volver a registrar). Nunca toca un negocio que ya está dado de alta.
 */
export async function undoProvisioning(
  slug: string,
  context: AdminContext,
  deps: ProvisioningDeps = {},
): Promise<void> {
  const resolved = resolve(deps);
  const { client, config } = resolved;
  const tenant = await tenantBySlug(client, slug);
  const run = await latestRun(client, tenant.id);
  if (!run || run.status === "SUCCEEDED" || run.status === "UNDONE") {
    throw new ConflictError(
      run?.status === "UNDONE"
        ? "El alta de ese negocio ya se deshizo"
        : "Ese negocio ya está dado de alta: no se puede deshacer",
    );
  }
  if (!(await claimRun(resolved, run.id, false))) {
    throw new ConflictError("El alta sigue en marcha: espera unos minutos antes de deshacerla");
  }
  if (tenant.dbName && tenant.dbRole) {
    await dropTenantResources(config.adminUrl, { database: tenant.dbName, role: tenant.dbRole });
  }
  await client.$transaction(async (tx) => {
    await tx.provisioningRun.update({
      where: { id: run.id },
      data: { status: "UNDONE", secretEnc: null, finishedAt: resolved.now() },
    });
    // Los nombres de la base y del rol se conservan (salen del id); la credencial y la versión ya no corresponden a nada.
    await tx.tenant.update({
      where: { id: tenant.id },
      data: { status: "FAILED", dbCredentialEnc: null, schemaVersion: null },
    });
    await recordPlatformAudit(tx, {
      action: "TENANT_PROVISION_UNDONE",
      actor: context.actor,
      tenantId: tenant.id,
      targetType: "Tenant",
      targetId: tenant.id,
      details: { slug: tenant.slug, attempt: run.attempt },
      ip: context.ip,
    });
  });
}
