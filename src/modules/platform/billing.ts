import { z } from "zod";

import { platformMessages } from "@/config/messages.platform.es";
import { PLAN_FEATURES } from "@/config/plan-catalog";
import type { Plan, Prisma, Subscription } from "@/generated/control/client";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import {
  addMonths,
  BILLING_INTERVALS,
  computeBillingPosition,
  INTERVAL_MONTHS,
  parseLimits,
  type BillingPosition,
} from "@/lib/tenancy/billing";
import { controlDb, type ControlDb } from "@/lib/tenancy/control-db";
import { invalidateTenantDirectory } from "@/lib/tenancy/control-directory";
import { recordPlatformAudit, type PlatformAuditAction } from "@/modules/platform/audit";
import { DEFAULT_RETENTION_DAYS, requestTenantDeletion } from "@/modules/platform/lifecycle";
import { startSubscription } from "@/modules/platform/subscription-start";
import type { AdminContext } from "@/modules/platform/service";

/**
 * Planes, suscripciones y pagos (propuesta SaaS §5), del lado de la plataforma.
 *
 * - Un **plan** es lo que se vende: precio, cada cuánto se cobra, límites y módulos. Los planes no se borran (hay
 *   suscripciones que los referencian): se desactivan para que no se asignen más.
 * - Una **suscripción** liga un negocio con un plan y dice hasta cuándo está pagado. El historial nunca se edita: cambiar de
 *   plan cierra la fila vieja (`EXPIRED`) y abre otra; renovar solo mueve el vencimiento de la vigente (cada pago queda aparte).
 * - Un **pago** es manual en la v1 (efectivo, transferencia…): quien opera lo registra y el vencimiento se extiende. Los pagos
 *   solo se insertan.
 * - Lo que el negocio puede hacer **no se guarda: se calcula** con la hora actual (`tenancy/billing.ts`). El barrido diario
 *   solo anota los cambios de estado, deja la auditoría y pide la baja de los negocios cancelados.
 */

const copy = platformMessages.billing.validation;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Motivo con el que el barrido pide la baja de un negocio cancelado; un pago posterior cancela solo esa baja. */
export const BILLING_DELETION_REASON = "Suscripción cancelada por falta de pago";

type Tx = Prisma.TransactionClient;
export type BillingDeps = { client?: ControlDb; now?: () => Date };

const nowOf = (deps: BillingDeps): Date => (deps.now ?? (() => new Date()))();

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

function parseOrThrow<T>(
  result: { success: true; data: T } | { success: false; error: { issues: { message: string }[] } },
): T {
  if (!result.success) {
    throw new ValidationError(result.error.issues[0]?.message ?? "Datos no válidos");
  }
  return result.data;
}

function cleanReason(raw: string | undefined): string {
  const reason = (raw ?? "").trim();
  if (reason.length < 3 || reason.length > 300) {
    throw new ValidationError(copy.reason);
  }
  return reason;
}

// ───────────────────────────── Planes ─────────────────────────────

const limitSchema = z
  .number(copy.limit)
  .int(copy.limit)
  .min(0, copy.limit)
  .max(1_000_000, copy.limit)
  .nullable();

export const planSchema = z.object({
  name: z.string().trim().min(2, copy.planName).max(60, copy.planName),
  description: z
    .string()
    .trim()
    .max(300, copy.planDescription)
    .nullish()
    .transform((value) => value || null),
  priceCents: z.number(copy.price).int(copy.price).min(0, copy.price).max(100_000_000, copy.price),
  interval: z.enum(BILLING_INTERVALS, copy.interval),
  limits: z.object({
    users: limitSchema,
    products: limitSchema,
    terminals: limitSchema,
    locations: limitSchema,
  }),
  features: z.array(z.enum(PLAN_FEATURES, copy.features)).transform((list) => [...new Set(list)]),
  trialDays: z
    .number(copy.trialDays)
    .int(copy.trialDays)
    .min(0, copy.trialDays)
    .max(365, copy.trialDays),
  sortOrder: z
    .number(copy.sortOrder)
    .int(copy.sortOrder)
    .min(0, copy.sortOrder)
    .max(1000, copy.sortOrder),
  /** Por omisión, un plan nuevo está activo; al editar, si no se indica, no cambia. */
  isActive: z.boolean().optional(),
});

export type PlanInput = z.input<typeof planSchema>;

export type PlanRow = Plan & { activeSubscriptions: number };

export async function listPlans(deps: BillingDeps = {}): Promise<PlanRow[]> {
  const client = deps.client ?? controlDb;
  const plans = await client.plan.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { subscriptions: { where: { status: { not: "EXPIRED" } } } } } },
  });
  return plans.map(({ _count, ...plan }) => ({
    ...plan,
    activeSubscriptions: _count.subscriptions,
  }));
}

export async function getPlan(id: string, deps: BillingDeps = {}): Promise<Plan | null> {
  return (deps.client ?? controlDb).plan.findUnique({ where: { id } });
}

function planSummary(
  plan: Pick<
    Plan,
    "name" | "priceCents" | "interval" | "limits" | "features" | "trialDays" | "isActive"
  >,
) {
  return {
    name: plan.name,
    priceCents: plan.priceCents,
    interval: plan.interval,
    limits: parseLimits(plan.limits),
    features: plan.features,
    trialDays: plan.trialDays,
    isActive: plan.isActive,
  };
}

export async function createPlan(
  input: unknown,
  context: AdminContext,
  deps: BillingDeps = {},
): Promise<{ id: string }> {
  const client = deps.client ?? controlDb;
  const data = parseOrThrow(planSchema.safeParse(input));
  try {
    return await client.$transaction(async (tx) => {
      const plan = await tx.plan.create({ data: { ...data, isActive: data.isActive ?? true } });
      await recordPlatformAudit(tx, {
        action: "PLAN_CREATED",
        actor: context.actor,
        targetType: "Plan",
        targetId: plan.id,
        details: planSummary(plan),
        ip: context.ip,
      });
      return { id: plan.id };
    });
  } catch (error) {
    throw isUniqueViolation(error) ? new ConflictError(copy.planNameTaken) : error;
  }
}

/**
 * Cambia un plan. Los negocios que ya lo tienen ven los módulos y límites nuevos de inmediato (en unos segundos), pero **su
 * precio acordado no cambia**: está copiado en su suscripción.
 */
export async function updatePlan(
  id: string,
  input: unknown,
  context: AdminContext,
  deps: BillingDeps = {},
): Promise<void> {
  const client = deps.client ?? controlDb;
  const data = parseOrThrow(planSchema.safeParse(input));
  try {
    await client.$transaction(async (tx) => {
      const before = await tx.plan.findUnique({ where: { id } });
      if (!before) {
        throw new NotFoundError(copy.planNotFound);
      }
      const plan = await tx.plan.update({ where: { id }, data });
      await recordPlatformAudit(tx, {
        action: "PLAN_UPDATED",
        actor: context.actor,
        targetType: "Plan",
        targetId: id,
        details: { before: planSummary(before), after: planSummary(plan) },
        ip: context.ip,
      });
    });
  } catch (error) {
    throw isUniqueViolation(error) ? new ConflictError(copy.planNameTaken) : error;
  }
  invalidateTenantDirectory();
}

export async function setPlanActive(
  id: string,
  active: boolean,
  context: AdminContext,
  deps: BillingDeps = {},
): Promise<void> {
  const client = deps.client ?? controlDb;
  await client.$transaction(async (tx) => {
    const before = await tx.plan.findUnique({ where: { id } });
    if (!before) {
      throw new NotFoundError(copy.planNotFound);
    }
    if (before.isActive === active) {
      return;
    }
    await tx.plan.update({ where: { id }, data: { isActive: active } });
    await recordPlatformAudit(tx, {
      action: "PLAN_UPDATED",
      actor: context.actor,
      targetType: "Plan",
      targetId: id,
      details: { name: before.name, isActive: { before: before.isActive, after: active } },
      ip: context.ip,
    });
  });
}

// ───────────────────────────── Suscripciones ─────────────────────────────

type CurrentSubscription = Subscription & { plan: Plan };

async function tenantForBilling(tx: Tx, slug: string) {
  const tenant = await tx.tenant.findUnique({ where: { slug } });
  if (!tenant) {
    throw new NotFoundError("No existe ese negocio");
  }
  if (
    tenant.status === "DELETED" ||
    tenant.status === "FAILED" ||
    tenant.status === "PROVISIONING"
  ) {
    throw new ConflictError(copy.tenantNotBillable);
  }
  return tenant;
}

async function currentOf(tx: Tx, tenantId: string): Promise<CurrentSubscription | null> {
  return tx.subscription.findFirst({
    where: { tenantId, status: { not: "EXPIRED" } },
    include: { plan: true },
  });
}

async function activePlan(tx: Tx, planId: string): Promise<Plan> {
  const plan = await tx.plan.findUnique({ where: { id: planId } });
  if (!plan) {
    throw new NotFoundError(copy.planNotFound);
  }
  if (!plan.isActive) {
    throw new ConflictError(copy.planInactive);
  }
  return plan;
}

function positionOf(
  sub: Pick<Subscription, "isTrial" | "currentPeriodEnd" | "graceDays" | "readOnlyDays">,
  now: Date,
): BillingPosition {
  return computeBillingPosition(sub, now);
}

export type AssignPlanInput = {
  slug: string;
  planId: string;
  /** Prueba gratuita (vence a los `trialDays` del plan) o suscripción ya vigente sin prueba. */
  trial: boolean;
  /** Si se indica, es el vencimiento; si no, se calcula (fin de la prueba o un periodo del plan). */
  periodEnd?: Date | undefined;
  reason: string;
};

/** Le pone plan a un negocio que no tiene (p. ej. el negocio #1 o uno anterior a los planes). */
export async function assignPlan(
  input: AssignPlanInput,
  context: AdminContext,
  deps: BillingDeps = {},
): Promise<{ periodEnd: Date }> {
  const client = deps.client ?? controlDb;
  const now = nowOf(deps);
  const reason = cleanReason(input.reason);
  if (input.periodEnd && Number.isNaN(input.periodEnd.getTime())) {
    throw new ValidationError(copy.periodEnd);
  }
  const result = await client.$transaction(async (tx) => {
    const tenant = await tenantForBilling(tx, input.slug);
    if (await currentOf(tx, tenant.id)) {
      throw new ConflictError(copy.hasSubscription);
    }
    const plan = await activePlan(tx, input.planId);
    const sub = await startSubscription(tx, {
      tenantId: tenant.id,
      plan,
      trial: input.trial,
      now,
      ...(input.periodEnd ? { periodEnd: input.periodEnd } : {}),
      reason,
    });
    await recordPlatformAudit(tx, {
      action: "SUBSCRIPTION_ASSIGNED",
      actor: context.actor,
      tenantId: tenant.id,
      targetType: "Subscription",
      targetId: sub.id,
      details: {
        slug: tenant.slug,
        plan: plan.name,
        trial: input.trial,
        periodEnd: sub.currentPeriodEnd.toISOString(),
        reason,
      },
      ip: context.ip,
    });
    return { periodEnd: sub.currentPeriodEnd };
  });
  invalidateTenantDirectory();
  return result;
}

export type ChangePlanInput = {
  slug: string;
  planId: string;
  /** `now`: cambia ya, sin tocar las fechas pagadas. `renewal`: entra en vigor con el próximo pago. */
  when: "now" | "renewal";
  reason: string;
};

/**
 * Cambia el plan de un negocio sin perder nada: los datos no se tocan y las fechas pagadas se conservan. Si el plan nuevo
 * tiene menos tope que el uso actual, no se borra nada; solo se impide crear más.
 */
export async function changePlan(
  input: ChangePlanInput,
  context: AdminContext,
  deps: BillingDeps = {},
): Promise<void> {
  const client = deps.client ?? controlDb;
  const now = nowOf(deps);
  const reason = cleanReason(input.reason);
  await client.$transaction(async (tx) => {
    const tenant = await tenantForBilling(tx, input.slug);
    const current = await currentOf(tx, tenant.id);
    if (!current) {
      throw new ConflictError(copy.noSubscription);
    }
    const plan = await activePlan(tx, input.planId);

    if (input.when === "renewal") {
      const next = plan.id === current.planId ? null : plan.id;
      if (next === current.nextPlanId) {
        throw new ConflictError(copy.noChange);
      }
      await tx.subscription.update({ where: { id: current.id }, data: { nextPlanId: next } });
      await recordPlatformAudit(tx, {
        action: "SUBSCRIPTION_PLAN_SCHEDULED",
        actor: context.actor,
        tenantId: tenant.id,
        targetType: "Subscription",
        targetId: current.id,
        details: {
          slug: tenant.slug,
          from: current.plan.name,
          to: next ? plan.name : null,
          reason,
        },
        ip: context.ip,
      });
      return;
    }

    if (plan.id === current.planId) {
      throw new ConflictError(copy.samePlan);
    }
    await tx.subscription.update({
      where: { id: current.id },
      data: { status: "EXPIRED", endedAt: now, nextPlanId: null },
    });
    const replacement = await tx.subscription.create({
      data: {
        tenantId: tenant.id,
        planId: plan.id,
        status: positionOf(current, now).status,
        isTrial: current.isTrial,
        startsAt: now,
        currentPeriodStart: current.currentPeriodStart,
        currentPeriodEnd: current.currentPeriodEnd,
        graceDays: current.graceDays,
        readOnlyDays: current.readOnlyDays,
        priceCentsSnapshot: plan.priceCents,
        intervalSnapshot: plan.interval,
        reason,
      },
    });
    await recordPlatformAudit(tx, {
      action: "SUBSCRIPTION_PLAN_CHANGED",
      actor: context.actor,
      tenantId: tenant.id,
      targetType: "Subscription",
      targetId: replacement.id,
      details: {
        slug: tenant.slug,
        from: planSummary(current.plan),
        to: planSummary(plan),
        periodEnd: current.currentPeriodEnd.toISOString(),
        reason,
      },
      ip: context.ip,
    });
  });
  invalidateTenantDirectory();
}

type TenantForBilling = Awaited<ReturnType<typeof tenantForBilling>>;

/**
 * Si la baja pendiente de un negocio la pidió el barrido por falta de pago y el negocio ya está al corriente, la cancela.
 * Una baja pedida por una persona nunca se toca aquí.
 */
async function cancelBillingDeletion(
  tx: Tx,
  tenant: TenantForBilling,
  context: AdminContext,
  cause: "payment" | "adjustment",
): Promise<boolean> {
  if (tenant.status !== "PENDING_DELETION" || tenant.deletionReason !== BILLING_DELETION_REASON) {
    return false;
  }
  const back = tenant.statusBeforeDeletion ?? "ACTIVE";
  await tx.tenant.update({
    where: { id: tenant.id },
    data: {
      status: back,
      statusBeforeDeletion: null,
      deletionRequestedAt: null,
      deleteAfter: null,
      deletionReason: null,
    },
  });
  await recordPlatformAudit(tx, {
    action: "TENANT_DELETION_CANCELLED",
    actor: context.actor,
    tenantId: tenant.id,
    targetType: "Tenant",
    targetId: tenant.id,
    details: { slug: tenant.slug, restoredTo: back, cause },
    ip: context.ip,
  });
  return true;
}

export const PAYMENT_METHODS = ["CASH", "TRANSFER", "CARD", "OTHER"] as const;

export type RegisterPaymentInput = {
  slug: string;
  amountCents: number;
  method: (typeof PAYMENT_METHODS)[number];
  reference?: string | undefined;
  note?: string | undefined;
  /** Cuándo se pagó; por omisión, ahora. No puede ser futura. */
  paidAt?: Date | undefined;
  /** Cuántos periodos del plan cubre (1 a 24). */
  periods?: number | undefined;
};

export type RegisterPaymentResult = {
  coversFrom: Date;
  coversUntil: Date;
  /** La baja que había pedido el barrido por falta de pago se canceló con este pago. */
  deletionCancelled: boolean;
};

/**
 * Registra un pago manual y extiende el vencimiento: desde el fin del periodo actual si todavía no vence (se conservan los
 * días ya pagados), o desde hoy si ya venció. Un pago pone al negocio al corriente: sale de la gracia, del solo lectura o de la
 * cancelación, y cancela la baja que el sistema había pedido por falta de pago (no una baja pedida por una persona).
 */
export async function registerPayment(
  input: RegisterPaymentInput,
  context: AdminContext,
  deps: BillingDeps = {},
): Promise<RegisterPaymentResult> {
  const client = deps.client ?? controlDb;
  const now = nowOf(deps);
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new ValidationError(copy.amount);
  }
  if (!PAYMENT_METHODS.includes(input.method)) {
    throw new ValidationError(copy.method);
  }
  const periods = input.periods ?? 1;
  if (!Number.isInteger(periods) || periods < 1 || periods > 24) {
    throw new ValidationError(copy.periods);
  }
  const paidAt = input.paidAt ?? now;
  if (Number.isNaN(paidAt.getTime()) || paidAt.getTime() > now.getTime() + DAY_MS) {
    throw new ValidationError(copy.paidAtFuture);
  }
  const reference = input.reference?.trim() || null;
  const note = input.note?.trim() || null;
  if ((reference?.length ?? 0) > 120 || (note?.length ?? 0) > 300) {
    throw new ValidationError(copy.planDescription);
  }

  const result = await client.$transaction(async (tx) => {
    const tenant = await tenantForBilling(tx, input.slug);
    const found = await currentOf(tx, tenant.id);
    if (!found) {
      throw new ConflictError(copy.noSubscription);
    }
    const before = positionOf(found, now);

    // Un cambio de plan programado para la renovación entra en vigor con este pago.
    let active: Subscription = found;
    if (found.nextPlanId) {
      const next = await tx.plan.findUnique({ where: { id: found.nextPlanId } });
      if (next) {
        await tx.subscription.update({
          where: { id: found.id },
          data: { status: "EXPIRED", endedAt: now, nextPlanId: null },
        });
        active = await tx.subscription.create({
          data: {
            tenantId: tenant.id,
            planId: next.id,
            status: before.status,
            isTrial: false,
            startsAt: now,
            currentPeriodStart: found.currentPeriodStart,
            currentPeriodEnd: found.currentPeriodEnd,
            graceDays: found.graceDays,
            readOnlyDays: found.readOnlyDays,
            priceCentsSnapshot: next.priceCents,
            intervalSnapshot: next.interval,
            reason: "Cambio de plan programado, aplicado con el pago",
          },
        });
      }
    }

    const stillRunning = active.currentPeriodEnd.getTime() > now.getTime();
    const coversFrom = stillRunning ? active.currentPeriodEnd : now;
    const coversUntil = addMonths(coversFrom, INTERVAL_MONTHS[active.intervalSnapshot] * periods);
    await tx.subscription.update({
      where: { id: active.id },
      data: {
        status: "ACTIVE",
        isTrial: false,
        currentPeriodStart: stillRunning ? active.currentPeriodStart : coversFrom,
        currentPeriodEnd: coversUntil,
      },
    });
    const payment = await tx.platformPayment.create({
      data: {
        tenantId: tenant.id,
        subscriptionId: active.id,
        amountCents: input.amountCents,
        method: input.method,
        reference,
        note,
        paidAt,
        coversFrom,
        coversUntil,
        registeredById: context.actor?.id ?? null,
        registeredByUsername: context.actor?.username ?? null,
      },
    });
    await recordPlatformAudit(tx, {
      action: "SUBSCRIPTION_PAYMENT_REGISTERED",
      actor: context.actor,
      tenantId: tenant.id,
      targetType: "PlatformPayment",
      targetId: payment.id,
      details: {
        slug: tenant.slug,
        amountCents: input.amountCents,
        method: input.method,
        reference,
        periods,
        coversFrom: coversFrom.toISOString(),
        coversUntil: coversUntil.toISOString(),
        modeBefore: before.mode,
      },
      ip: context.ip,
    });

    const deletionCancelled = await cancelBillingDeletion(tx, tenant, context, "payment");
    return { coversFrom, coversUntil, deletionCancelled };
  });
  invalidateTenantDirectory();
  return result;
}

export type AdjustSubscriptionInput = {
  slug: string;
  /** Nuevo vencimiento (cortesía, corrección o acuerdo especial). */
  currentPeriodEnd?: Date | undefined;
  graceDays?: number | undefined;
  readOnlyDays?: number | undefined;
  reason: string;
};

/** Ajusta a mano el vencimiento o los plazos de gracia y solo lectura de un negocio, con motivo y en la auditoría. */
export async function adjustSubscription(
  input: AdjustSubscriptionInput,
  context: AdminContext,
  deps: BillingDeps = {},
): Promise<void> {
  const client = deps.client ?? controlDb;
  const now = nowOf(deps);
  const reason = cleanReason(input.reason);
  if (input.currentPeriodEnd && Number.isNaN(input.currentPeriodEnd.getTime())) {
    throw new ValidationError(copy.periodEnd);
  }
  if (
    input.graceDays !== undefined &&
    (!Number.isInteger(input.graceDays) || input.graceDays < 0 || input.graceDays > 90)
  ) {
    throw new ValidationError(copy.graceDays);
  }
  if (
    input.readOnlyDays !== undefined &&
    (!Number.isInteger(input.readOnlyDays) || input.readOnlyDays < 0 || input.readOnlyDays > 365)
  ) {
    throw new ValidationError(copy.readOnlyDays);
  }

  await client.$transaction(async (tx) => {
    const tenant = await tenantForBilling(tx, input.slug);
    const current = await currentOf(tx, tenant.id);
    if (!current) {
      throw new ConflictError(copy.noSubscription);
    }
    const next = {
      currentPeriodEnd: input.currentPeriodEnd ?? current.currentPeriodEnd,
      graceDays: input.graceDays ?? current.graceDays,
      readOnlyDays: input.readOnlyDays ?? current.readOnlyDays,
    };
    if (
      next.currentPeriodEnd.getTime() === current.currentPeriodEnd.getTime() &&
      next.graceDays === current.graceDays &&
      next.readOnlyDays === current.readOnlyDays
    ) {
      throw new ConflictError(copy.noChange);
    }
    if (next.currentPeriodEnd.getTime() < current.currentPeriodStart.getTime()) {
      throw new ValidationError(copy.periodEndOrder);
    }
    await tx.subscription.update({
      where: { id: current.id },
      data: { ...next, status: positionOf({ ...current, ...next }, now).status },
    });
    await recordPlatformAudit(tx, {
      action: "SUBSCRIPTION_ADJUSTED",
      actor: context.actor,
      tenantId: tenant.id,
      targetType: "Subscription",
      targetId: current.id,
      details: {
        slug: tenant.slug,
        before: {
          currentPeriodEnd: current.currentPeriodEnd.toISOString(),
          graceDays: current.graceDays,
          readOnlyDays: current.readOnlyDays,
        },
        after: {
          currentPeriodEnd: next.currentPeriodEnd.toISOString(),
          graceDays: next.graceDays,
          readOnlyDays: next.readOnlyDays,
        },
        reason,
      },
      ip: context.ip,
    });
    if (positionOf({ ...current, ...next }, now).mode !== "blocked") {
      await cancelBillingDeletion(tx, tenant, context, "adjustment");
    }
  });
  invalidateTenantDirectory();
}

// ───────────────────────────── Barrido diario ─────────────────────────────

export type SweepTransition = { slug: string; from: string; to: string };

export type SweepReport = {
  checked: number;
  transitions: SweepTransition[];
  /** Negocios cancelados cuya baja se pidió en este barrido. */
  deletionsRequested: string[];
};

const TRANSITION_AUDIT: Partial<Record<string, PlatformAuditAction>> = {
  PAST_DUE: "SUBSCRIPTION_PAST_DUE",
  SUSPENDED: "SUBSCRIPTION_READ_ONLY",
  CANCELLED: "SUBSCRIPTION_CANCELLED",
};

/**
 * Anota los cambios de estado de las suscripciones (gracia → solo lectura → cancelada), deja la auditoría de cada uno y pide
 * la baja —reversible, con retención— de los negocios cancelados. Es **repetible**: lo que ya está anotado no se vuelve a
 * hacer. No decide el acceso (eso se calcula con la hora en cada petición), así que un día sin barrido no deja a nadie con
 * más ni menos acceso del que le toca.
 */
export async function sweepSubscriptions(
  context: AdminContext = { actor: null },
  deps: BillingDeps & { retentionDays?: number } = {},
): Promise<SweepReport> {
  const client = deps.client ?? controlDb;
  const now = nowOf(deps);
  const report: SweepReport = { checked: 0, transitions: [], deletionsRequested: [] };

  const subscriptions = await client.subscription.findMany({
    where: {
      status: { not: "EXPIRED" },
      tenant: { status: { in: ["ACTIVE", "SUSPENDED", "PENDING_DELETION", "MIGRATION_FAILED"] } },
    },
    include: { tenant: { select: { id: true, slug: true, status: true } } },
    orderBy: { currentPeriodEnd: "asc" },
  });

  for (const sub of subscriptions) {
    report.checked += 1;
    const position = positionOf(sub, now);

    if (position.status !== sub.status) {
      await client.$transaction(async (tx) => {
        await tx.subscription.update({ where: { id: sub.id }, data: { status: position.status } });
        const action = TRANSITION_AUDIT[position.status];
        if (action) {
          await recordPlatformAudit(tx, {
            action,
            actor: context.actor,
            tenantId: sub.tenant.id,
            targetType: "Subscription",
            targetId: sub.id,
            details: {
              slug: sub.tenant.slug,
              from: sub.status,
              to: position.status,
              periodEnd: position.periodEnd.toISOString(),
            },
            ip: context.ip,
          });
        }
      });
      report.transitions.push({ slug: sub.tenant.slug, from: sub.status, to: position.status });
    }

    if (
      position.mode === "blocked" &&
      (sub.tenant.status === "ACTIVE" || sub.tenant.status === "SUSPENDED")
    ) {
      await requestTenantDeletion(
        { slug: sub.tenant.slug, reason: BILLING_DELETION_REASON },
        context,
        {
          client,
          now: () => now,
          retentionDays: deps.retentionDays ?? DEFAULT_RETENTION_DAYS,
        },
      );
      report.deletionsRequested.push(sub.tenant.slug);
    }
  }
  if (report.transitions.length > 0 || report.deletionsRequested.length > 0) {
    invalidateTenantDirectory();
  }
  return report;
}

// ───────────────────────────── Consultas del panel ─────────────────────────────

export type SubscriptionView = {
  id: string;
  plan: { id: string; name: string };
  nextPlan: { id: string; name: string } | null;
  status: Subscription["status"];
  isTrial: boolean;
  position: BillingPosition;
  startsAt: Date;
  currentPeriodStart: Date;
  graceDays: number;
  readOnlyDays: number;
  priceCentsSnapshot: number;
  intervalSnapshot: Subscription["intervalSnapshot"];
  endedAt: Date | null;
  reason: string | null;
};

export type TenantBilling = {
  current: SubscriptionView | null;
  history: SubscriptionView[];
  payments: {
    id: string;
    amountCents: number;
    method: (typeof PAYMENT_METHODS)[number];
    reference: string | null;
    note: string | null;
    paidAt: Date;
    coversFrom: Date;
    coversUntil: Date;
    registeredByUsername: string | null;
  }[];
};

export async function getTenantBilling(
  slug: string,
  deps: BillingDeps = {},
): Promise<TenantBilling | null> {
  const client = deps.client ?? controlDb;
  const now = nowOf(deps);
  const tenant = await client.tenant.findUnique({
    where: { slug },
    select: {
      subscriptions: { orderBy: { startsAt: "desc" }, include: { plan: true } },
      payments: { orderBy: { paidAt: "desc" }, take: 50 },
    },
  });
  if (!tenant) {
    return null;
  }
  const plans = new Map<string, string>();
  for (const sub of tenant.subscriptions) {
    plans.set(sub.plan.id, sub.plan.name);
  }
  const nextIds = tenant.subscriptions.flatMap((sub) => (sub.nextPlanId ? [sub.nextPlanId] : []));
  if (nextIds.length > 0) {
    for (const plan of await client.plan.findMany({ where: { id: { in: nextIds } } })) {
      plans.set(plan.id, plan.name);
    }
  }
  const toView = (sub: CurrentSubscription): SubscriptionView => ({
    id: sub.id,
    plan: { id: sub.plan.id, name: sub.plan.name },
    nextPlan: sub.nextPlanId
      ? { id: sub.nextPlanId, name: plans.get(sub.nextPlanId) ?? "—" }
      : null,
    status: sub.status,
    isTrial: sub.isTrial,
    position: positionOf(sub, now),
    startsAt: sub.startsAt,
    currentPeriodStart: sub.currentPeriodStart,
    graceDays: sub.graceDays,
    readOnlyDays: sub.readOnlyDays,
    priceCentsSnapshot: sub.priceCentsSnapshot,
    intervalSnapshot: sub.intervalSnapshot,
    endedAt: sub.endedAt,
    reason: sub.reason,
  });
  const views = tenant.subscriptions.map(toView);
  return {
    current: views.find((view) => view.status !== "EXPIRED") ?? null,
    history: views.filter((view) => view.status === "EXPIRED"),
    payments: tenant.payments,
  };
}

export type BillingOverviewRow = {
  slug: string;
  name: string;
  plan: string;
  mode: BillingPosition["mode"];
  status: BillingPosition["status"];
  isTrial: boolean;
  periodEnd: Date;
  daysToPeriodEnd: number;
};

/**
 * Los negocios con suscripción que necesitan atención, ordenados por urgencia: por vencer pronto, en gracia, en solo lectura y
 * cancelados. Es el aviso al operador (los negocios ven el suyo en su propia pantalla).
 */
export async function billingOverview(
  deps: BillingDeps & { dueSoonDays?: number } = {},
): Promise<{ attention: BillingOverviewRow[]; total: number }> {
  const client = deps.client ?? controlDb;
  const now = nowOf(deps);
  const dueSoonDays = deps.dueSoonDays ?? 7;
  const subs = await client.subscription.findMany({
    where: {
      status: { not: "EXPIRED" },
      tenant: { status: { in: ["ACTIVE", "SUSPENDED", "PENDING_DELETION", "MIGRATION_FAILED"] } },
    },
    include: { plan: { select: { name: true } }, tenant: { select: { slug: true, name: true } } },
  });
  const rank: Record<BillingPosition["mode"], number> = {
    blocked: 0,
    readonly: 1,
    grace: 2,
    full: 3,
  };
  const rows = subs
    .map((sub): BillingOverviewRow => {
      const position = positionOf(sub, now);
      return {
        slug: sub.tenant.slug,
        name: sub.tenant.name,
        plan: sub.plan.name,
        mode: position.mode,
        status: position.status,
        isTrial: sub.isTrial,
        periodEnd: position.periodEnd,
        daysToPeriodEnd: position.daysToPeriodEnd,
      };
    })
    .filter((row) => row.mode !== "full" || row.daysToPeriodEnd <= dueSoonDays)
    .sort((a, b) => rank[a.mode] - rank[b.mode] || a.periodEnd.getTime() - b.periodEnd.getTime());
  return { attention: rows, total: subs.length };
}
