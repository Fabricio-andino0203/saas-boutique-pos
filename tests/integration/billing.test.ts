import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { addMonths } from "@/lib/tenancy/billing";
import {
  adjustSubscription,
  assignPlan,
  BILLING_DELETION_REASON,
  billingOverview,
  changePlan,
  createPlan,
  getTenantBilling,
  listPlans,
  registerPayment,
  setPlanActive,
  sweepSubscriptions,
  updatePlan,
} from "@/modules/platform/billing";
import { seedExamplePlans } from "@/modules/platform/example-plans";
import {
  closeControlTestDatabase,
  controlTestDb,
  resetControlDatabase,
} from "./helpers/control-db";

/**
 * Etapa 4: planes, suscripciones y pagos en la base central real. Las fechas se controlan con un reloj de prueba para
 * recorrer el ciclo completo (prueba → pagada → gracia → solo lectura → cancelada → reactivada) sin esperar.
 */

const context = { actor: { id: "admin-1", username: "admin-prueba" }, ip: "10.0.0.1" };
const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date("2026-11-01T12:00:00.000Z");
let now = T0;
const at = (days: number) => new Date(T0.getTime() + days * DAY);
const deps = () => ({ client: controlTestDb, now: () => now });

const planInput = (overrides: Record<string, unknown> = {}) => ({
  name: "Estándar",
  description: "Para empezar",
  priceCents: 90_000,
  interval: "MONTHLY" as const,
  limits: { users: 3, products: null, terminals: null, locations: null },
  features: ["reports", "customers"],
  trialDays: 14,
  sortOrder: 1,
  ...overrides,
});

async function newPlan(overrides: Record<string, unknown> = {}): Promise<string> {
  return (await createPlan(planInput(overrides), context, deps())).id;
}

async function newTenant(slug: string, status = "ACTIVE"): Promise<void> {
  // Un negocio que opera tiene su base, su rol y su credencial (restricción de la base central): aquí son valores de relleno.
  const operating = ["ACTIVE", "SUSPENDED", "MIGRATION_FAILED"].includes(status);
  const database = `t_${slug.replace(/-/g, "_")}`;
  await controlTestDb.tenant.create({
    data: {
      slug,
      name: `Negocio ${slug}`,
      status: status as never,
      ...(operating ? { dbName: database, dbRole: database, dbCredentialEnc: "relleno" } : {}),
    },
  });
}

/** Un negocio con plan y vencimiento ya vigente (sin prueba), como si lo hubiera pagado. */
async function paidTenant(slug: string, planId: string, endsInDays: number): Promise<void> {
  await newTenant(slug);
  await assignPlan(
    { slug, planId, trial: false, periodEnd: at(endsInDays), reason: "Alta de prueba" },
    context,
    deps(),
  );
}

const current = (slug: string) =>
  controlTestDb.subscription.findFirstOrThrow({
    where: { tenant: { slug }, status: { not: "EXPIRED" } },
    include: { plan: true },
  });
const tenantRow = (slug: string) => controlTestDb.tenant.findUniqueOrThrow({ where: { slug } });
const audits = (action: string) =>
  controlTestDb.platformAuditLog.findMany({ where: { action }, orderBy: { at: "asc" } });

beforeEach(async () => {
  await resetControlDatabase();
  now = T0;
});

afterAll(async () => {
  await resetControlDatabase();
  await closeControlTestDatabase();
});

describe("plans", () => {
  it("creates a plan, remembers what it sells and leaves a trace", async () => {
    const id = await newPlan();
    const plan = await controlTestDb.plan.findUniqueOrThrow({ where: { id } });
    expect(plan).toMatchObject({
      name: "Estándar",
      priceCents: 90_000,
      interval: "MONTHLY",
      features: ["reports", "customers"],
      trialDays: 14,
      isActive: true,
    });
    expect(plan.limits).toEqual({
      users: 3,
      products: null,
      terminals: null,
      locations: null,
      photos: null, // un plan que no lo pide no limita las fotos
    });
    const [entry] = await audits("PLAN_CREATED");
    expect(entry).toMatchObject({ actorUsername: "admin-prueba", targetId: id });
  });

  it("refuses duplicates and nonsense", async () => {
    await newPlan();
    await expect(newPlan()).rejects.toBeInstanceOf(ConflictError);
    for (const bad of [
      { name: "x" },
      { priceCents: -1 },
      { priceCents: 1.5 },
      { interval: "WEEKLY" },
      { trialDays: 400 },
      { features: ["reports", "teletransporte"] },
      { limits: { users: -2, products: null, terminals: null, locations: null } },
      { limits: { users: 1.5, products: null, terminals: null, locations: null } },
    ]) {
      await expect(newPlan({ name: "Otro", ...bad }), JSON.stringify(bad)).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
  });

  it("changing a plan does not change the price a business already agreed to", async () => {
    const planId = await newPlan();
    await newTenant("tienda-a");
    await assignPlan({ slug: "tienda-a", planId, trial: false, reason: "Alta" }, context, deps());
    await updatePlan(
      planId,
      planInput({ priceCents: 120_000, features: ["customers"] }),
      context,
      deps(),
    );
    const sub = await current("tienda-a");
    expect(sub.priceCentsSnapshot).toBe(90_000);
    expect(sub.plan.priceCents).toBe(120_000);
    const [entry] = await audits("PLAN_UPDATED");
    expect(entry?.details).toMatchObject({
      before: { priceCents: 90_000 },
      after: { priceCents: 120_000 },
    });
  });

  it("a deactivated plan cannot be assigned, but keeps serving who already has it", async () => {
    const planId = await newPlan();
    await newTenant("tienda-a");
    await newTenant("tienda-b");
    await assignPlan({ slug: "tienda-a", planId, trial: true, reason: "Alta" }, context, deps());
    await setPlanActive(planId, false, context, deps());
    await expect(
      assignPlan({ slug: "tienda-b", planId, trial: true, reason: "Alta" }, context, deps()),
    ).rejects.toBeInstanceOf(ConflictError);
    expect((await current("tienda-a")).planId).toBe(planId);
    await setPlanActive(planId, true, context, deps());
    await expect(
      assignPlan({ slug: "tienda-b", planId, trial: true, reason: "Alta" }, context, deps()),
    ).resolves.toBeDefined();
  });

  it("counts the businesses that have each plan, not the ones that left", async () => {
    const basic = await newPlan({ name: "Básico" });
    const full = await newPlan({ name: "Completo" });
    await newTenant("tienda-a");
    await newTenant("tienda-b");
    await assignPlan(
      { slug: "tienda-a", planId: basic, trial: true, reason: "Alta" },
      context,
      deps(),
    );
    await assignPlan(
      { slug: "tienda-b", planId: basic, trial: true, reason: "Alta" },
      context,
      deps(),
    );
    await changePlan(
      { slug: "tienda-b", planId: full, when: "now", reason: "Creció" },
      context,
      deps(),
    );
    const counts = Object.fromEntries(
      (await listPlans({ client: controlTestDb })).map((plan) => [
        plan.name,
        plan.activeSubscriptions,
      ]),
    );
    expect(counts).toEqual({ Básico: 1, Completo: 1 });
  });

  it("creates the example plans once and does not touch the ones already changed", async () => {
    expect(await seedExamplePlans(context, deps())).toEqual(["Básico", "Estándar", "Completo"]);
    await controlTestDb.plan.updateMany({ where: { name: "Básico" }, data: { priceCents: 1 } });
    expect(await seedExamplePlans(context, deps())).toEqual([]);
    expect(
      (await controlTestDb.plan.findFirstOrThrow({ where: { name: "Básico" } })).priceCents,
    ).toBe(1);
  });
});

describe("starting a subscription", () => {
  it("a trial lasts the days the plan says, and counts as a trial until it is paid", async () => {
    const planId = await newPlan();
    await newTenant("tienda-a");
    const { periodEnd } = await assignPlan(
      { slug: "tienda-a", planId, trial: true, reason: "Alta" },
      context,
      deps(),
    );
    expect(periodEnd).toEqual(at(14));
    const sub = await current("tienda-a");
    expect(sub).toMatchObject({ status: "TRIAL", isTrial: true, graceDays: 7, readOnlyDays: 60 });
    expect(sub.priceCentsSnapshot).toBe(90_000);
    expect((await audits("SUBSCRIPTION_ASSIGNED")).length).toBe(1);
  });

  it("a paid start lasts one period of the plan, or the date you give", async () => {
    const planId = await newPlan();
    await newTenant("tienda-a");
    await newTenant("tienda-b");
    const a = await assignPlan(
      { slug: "tienda-a", planId, trial: false, reason: "Alta" },
      context,
      deps(),
    );
    expect(a.periodEnd).toEqual(addMonths(T0, 1));
    const b = await assignPlan(
      { slug: "tienda-b", planId, trial: false, periodEnd: at(90), reason: "Convenio" },
      context,
      deps(),
    );
    expect(b.periodEnd).toEqual(at(90));
    expect(await current("tienda-b")).toMatchObject({ status: "ACTIVE", isTrial: false });
  });

  it("can start a plan whose due date already passed, and the business is where its dates say", async () => {
    const planId = await newPlan();
    await newTenant("tienda-a");
    await newTenant("tienda-b");
    await assignPlan(
      { slug: "tienda-a", planId, trial: false, periodEnd: at(-3), reason: "Debía desde antes" },
      context,
      deps(),
    );
    await assignPlan(
      { slug: "tienda-b", planId, trial: false, periodEnd: at(-20), reason: "Debía desde antes" },
      context,
      deps(),
    );
    const grace = await current("tienda-a");
    expect(grace.status).toBe("PAST_DUE");
    expect(grace.currentPeriodStart.getTime()).toBeLessThan(grace.currentPeriodEnd.getTime());
    expect((await current("tienda-b")).status).toBe("SUSPENDED");
    expect((await billingOverview(deps())).attention.map((row) => [row.slug, row.mode])).toEqual([
      ["tienda-b", "readonly"],
      ["tienda-a", "grace"],
    ]);
  });

  it("refuses a second plan, a business that is not in service, an unknown one and a missing reason", async () => {
    const planId = await newPlan();
    await newTenant("tienda-a");
    await assignPlan({ slug: "tienda-a", planId, trial: true, reason: "Alta" }, context, deps());
    await expect(
      assignPlan({ slug: "tienda-a", planId, trial: true, reason: "Otra vez" }, context, deps()),
    ).rejects.toBeInstanceOf(ConflictError);

    for (const status of ["DELETED", "PROVISIONING", "FAILED"]) {
      await newTenant(`baja-${status.toLowerCase()}`, status);
      await expect(
        assignPlan(
          { slug: `baja-${status.toLowerCase()}`, planId, trial: true, reason: "Alta" },
          context,
          deps(),
        ),
        status,
      ).rejects.toBeInstanceOf(ConflictError);
    }
    await expect(
      assignPlan({ slug: "nadie", planId, trial: true, reason: "Alta" }, context, deps()),
    ).rejects.toBeInstanceOf(NotFoundError);
    await newTenant("tienda-b");
    await expect(
      assignPlan({ slug: "tienda-b", planId, trial: true, reason: " " }, context, deps()),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("payments", () => {
  it("paying during the trial keeps the days left and adds a paid period after them", async () => {
    const planId = await newPlan();
    await newTenant("tienda-a");
    await assignPlan({ slug: "tienda-a", planId, trial: true, reason: "Alta" }, context, deps());
    now = at(5);
    const result = await registerPayment(
      { slug: "tienda-a", amountCents: 90_000, method: "TRANSFER", reference: "TR-1" },
      context,
      deps(),
    );
    expect(result.coversFrom).toEqual(at(14));
    expect(result.coversUntil).toEqual(addMonths(at(14), 1));
    const sub = await current("tienda-a");
    expect(sub).toMatchObject({ status: "ACTIVE", isTrial: false });
    expect(sub.currentPeriodEnd).toEqual(result.coversUntil);
    const [payment] = await controlTestDb.platformPayment.findMany();
    expect(payment).toMatchObject({
      amountCents: 90_000,
      method: "TRANSFER",
      reference: "TR-1",
      registeredByUsername: "admin-prueba",
      subscriptionId: sub.id,
    });
    expect((await audits("SUBSCRIPTION_PAYMENT_REGISTERED")).length).toBe(1);
  });

  it("paying after the due date starts the new period today, not in the past", async () => {
    const planId = await newPlan();
    await paidTenant("tienda-a", planId, 10);
    now = at(40);
    const result = await registerPayment(
      { slug: "tienda-a", amountCents: 90_000, method: "CASH" },
      context,
      deps(),
    );
    expect(result.coversFrom).toEqual(at(40));
    expect(result.coversUntil).toEqual(addMonths(at(40), 1));
    expect((await current("tienda-a")).currentPeriodStart).toEqual(at(40));
  });

  it("covers as many periods as were paid", async () => {
    const planId = await newPlan();
    await paidTenant("tienda-a", planId, 10);
    const result = await registerPayment(
      { slug: "tienda-a", amountCents: 270_000, method: "CARD", periods: 3 },
      context,
      deps(),
    );
    expect(result.coversUntil).toEqual(addMonths(at(10), 3));
  });

  it("refuses wrong amounts, methods, periods, dates and a business without a plan", async () => {
    const planId = await newPlan();
    await paidTenant("tienda-a", planId, 10);
    const pay = (overrides: Record<string, unknown>) =>
      registerPayment(
        { slug: "tienda-a", amountCents: 90_000, method: "CASH", ...overrides } as never,
        context,
        deps(),
      );
    for (const bad of [
      { amountCents: 0 },
      { amountCents: -5 },
      { amountCents: 10.5 },
      { method: "BITCOIN" },
      { periods: 0 },
      { periods: 25 },
      { paidAt: at(5) },
    ]) {
      await expect(pay(bad), JSON.stringify(bad)).rejects.toBeInstanceOf(ValidationError);
    }
    await newTenant("sin-plan");
    await expect(
      registerPayment({ slug: "sin-plan", amountCents: 1, method: "CASH" }, context, deps()),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await controlTestDb.platformPayment.count()).toBe(0);
  });

  it("payments can never be edited or deleted, not even by the application", async () => {
    const planId = await newPlan();
    await paidTenant("tienda-a", planId, 10);
    await registerPayment(
      { slug: "tienda-a", amountCents: 90_000, method: "CASH" },
      context,
      deps(),
    );
    const payment = await controlTestDb.platformPayment.findFirstOrThrow();
    await expect(
      controlTestDb.platformPayment.update({ where: { id: payment.id }, data: { amountCents: 1 } }),
    ).rejects.toThrow();
    await expect(
      controlTestDb.platformPayment.delete({ where: { id: payment.id } }),
    ).rejects.toThrow();
    expect((await controlTestDb.platformPayment.findFirstOrThrow()).amountCents).toBe(90_000);
  });

  it("a payment cancels the deletion the system asked for, but never one a person asked for", async () => {
    const planId = await newPlan();
    await paidTenant("auto", planId, 10);
    await paidTenant("manual", planId, 10);
    const pending = {
      status: "PENDING_DELETION" as const,
      statusBeforeDeletion: "ACTIVE" as const,
      deletionRequestedAt: T0,
      deleteAfter: at(30),
    };
    await controlTestDb.tenant.update({
      where: { slug: "auto" },
      data: { ...pending, deletionReason: BILLING_DELETION_REASON },
    });
    await controlTestDb.tenant.update({
      where: { slug: "manual" },
      data: { ...pending, deletionReason: "El dueño cerró el negocio" },
    });

    const auto = await registerPayment(
      { slug: "auto", amountCents: 90_000, method: "CASH" },
      context,
      deps(),
    );
    const manual = await registerPayment(
      { slug: "manual", amountCents: 90_000, method: "CASH" },
      context,
      deps(),
    );
    expect(auto.deletionCancelled).toBe(true);
    expect(manual.deletionCancelled).toBe(false);
    expect(await tenantRow("auto")).toMatchObject({
      status: "ACTIVE",
      deletionReason: null,
      deleteAfter: null,
      statusBeforeDeletion: null,
    });
    expect(await tenantRow("manual")).toMatchObject({ status: "PENDING_DELETION" });
  });
});

describe("changing plan", () => {
  it("now: keeps the dates, closes the old row and opens a new one — nothing is edited in place", async () => {
    const basic = await newPlan({ name: "Básico", priceCents: 50_000 });
    const full = await newPlan({ name: "Completo", priceCents: 150_000 });
    await paidTenant("tienda-a", basic, 20);
    const before = await current("tienda-a");
    now = at(3);
    await changePlan(
      { slug: "tienda-a", planId: full, when: "now", reason: "Creció" },
      context,
      deps(),
    );

    const after = await current("tienda-a");
    expect(after.id).not.toBe(before.id);
    expect(after).toMatchObject({ planId: full, status: "ACTIVE", isTrial: false });
    expect(after.currentPeriodEnd).toEqual(before.currentPeriodEnd);
    expect(after.priceCentsSnapshot).toBe(150_000);
    const old = await controlTestDb.subscription.findUniqueOrThrow({ where: { id: before.id } });
    expect(old).toMatchObject({ status: "EXPIRED", endedAt: at(3), priceCentsSnapshot: 50_000 });
    const billing = await getTenantBilling("tienda-a", deps());
    expect(billing?.history.map((row) => row.plan.name)).toEqual(["Básico"]);
    expect((await audits("SUBSCRIPTION_PLAN_CHANGED")).length).toBe(1);
  });

  it("a business in trial stays in trial after changing plan", async () => {
    const basic = await newPlan({ name: "Básico" });
    const full = await newPlan({ name: "Completo" });
    await newTenant("tienda-a");
    await assignPlan(
      { slug: "tienda-a", planId: basic, trial: true, reason: "Alta" },
      context,
      deps(),
    );
    await changePlan(
      { slug: "tienda-a", planId: full, when: "now", reason: "Prueba otro" },
      context,
      deps(),
    );
    expect(await current("tienda-a")).toMatchObject({
      planId: full,
      isTrial: true,
      status: "TRIAL",
    });
  });

  it("refuses the same plan, a deactivated plan and a business without a plan", async () => {
    const basic = await newPlan({ name: "Básico" });
    const old = await newPlan({ name: "Viejo" });
    await paidTenant("tienda-a", basic, 20);
    await setPlanActive(old, false, context, deps());
    const change = (slug: string, planId: string) =>
      changePlan({ slug, planId, when: "now", reason: "Prueba" }, context, deps());
    await expect(change("tienda-a", basic)).rejects.toBeInstanceOf(ConflictError);
    await expect(change("tienda-a", old)).rejects.toBeInstanceOf(ConflictError);
    await newTenant("sin-plan");
    await expect(change("sin-plan", basic)).rejects.toBeInstanceOf(ConflictError);
  });

  it("at renewal: nothing changes now, and the next payment switches the plan and its price", async () => {
    const monthly = await newPlan({ name: "Mensual" });
    const annual = await newPlan({ name: "Anual", interval: "ANNUAL", priceCents: 900_000 });
    await paidTenant("tienda-a", monthly, 10);
    await changePlan(
      { slug: "tienda-a", planId: annual, when: "renewal", reason: "Pasa a anual" },
      context,
      deps(),
    );
    const scheduled = await current("tienda-a");
    expect(scheduled).toMatchObject({ planId: monthly, nextPlanId: annual });
    await expect(
      changePlan(
        { slug: "tienda-a", planId: annual, when: "renewal", reason: "Otra vez" },
        context,
        deps(),
      ),
    ).rejects.toBeInstanceOf(ConflictError);

    const result = await registerPayment(
      { slug: "tienda-a", amountCents: 900_000, method: "TRANSFER" },
      context,
      deps(),
    );
    expect(result.coversUntil).toEqual(addMonths(at(10), 12));
    const switched = await current("tienda-a");
    expect(switched).toMatchObject({
      planId: annual,
      nextPlanId: null,
      priceCentsSnapshot: 900_000,
      intervalSnapshot: "ANNUAL",
    });
    expect((await controlTestDb.platformPayment.findFirstOrThrow()).subscriptionId).toBe(
      switched.id,
    );
    expect(
      (await controlTestDb.subscription.findUniqueOrThrow({ where: { id: scheduled.id } })).status,
    ).toBe("EXPIRED");
  });

  it("scheduling the plan the business already has cancels the scheduled change", async () => {
    const monthly = await newPlan({ name: "Mensual" });
    const annual = await newPlan({ name: "Anual", interval: "ANNUAL" });
    await paidTenant("tienda-a", monthly, 10);
    await changePlan(
      { slug: "tienda-a", planId: annual, when: "renewal", reason: "Quizás" },
      context,
      deps(),
    );
    await changePlan(
      { slug: "tienda-a", planId: monthly, when: "renewal", reason: "Mejor no" },
      context,
      deps(),
    );
    expect((await current("tienda-a")).nextPlanId).toBeNull();
  });

  it("the database itself allows only one current subscription per business", async () => {
    const planId = await newPlan();
    await paidTenant("tienda-a", planId, 10);
    const tenant = await tenantRow("tienda-a");
    await expect(
      controlTestDb.subscription.create({
        data: {
          tenantId: tenant.id,
          planId,
          status: "ACTIVE",
          startsAt: T0,
          currentPeriodStart: T0,
          currentPeriodEnd: at(30),
          priceCentsSnapshot: 1,
          intervalSnapshot: "MONTHLY",
        },
      }),
    ).rejects.toThrow();
  });
});

describe("adjusting a subscription by hand", () => {
  it("moves the due date and the grace periods, with the reason on record", async () => {
    const planId = await newPlan();
    await paidTenant("tienda-a", planId, 10);
    await adjustSubscription(
      {
        slug: "tienda-a",
        currentPeriodEnd: at(40),
        graceDays: 15,
        readOnlyDays: 30,
        reason: "Cortesía",
      },
      context,
      deps(),
    );
    const sub = await current("tienda-a");
    expect(sub).toMatchObject({ graceDays: 15, readOnlyDays: 30 });
    expect(sub.currentPeriodEnd).toEqual(at(40));
    const [entry] = await audits("SUBSCRIPTION_ADJUSTED");
    expect(entry?.details).toMatchObject({
      reason: "Cortesía",
      before: { graceDays: 7, readOnlyDays: 60 },
      after: { graceDays: 15, readOnlyDays: 30 },
    });
  });

  it("refuses no-op changes, a missing reason, absurd periods and an end before the start", async () => {
    const planId = await newPlan();
    await paidTenant("tienda-a", planId, 10);
    const adjust = (overrides: Record<string, unknown>) =>
      adjustSubscription(
        { slug: "tienda-a", reason: "Prueba", ...overrides } as never,
        context,
        deps(),
      );
    await expect(adjust({})).rejects.toBeInstanceOf(ConflictError);
    await expect(adjust({ graceDays: 7 })).rejects.toBeInstanceOf(ConflictError);
    await expect(adjust({ graceDays: 5, reason: "" })).rejects.toBeInstanceOf(ValidationError);
    await expect(adjust({ graceDays: 91 })).rejects.toBeInstanceOf(ValidationError);
    await expect(adjust({ readOnlyDays: 366 })).rejects.toBeInstanceOf(ValidationError);
    await expect(adjust({ readOnlyDays: -1 })).rejects.toBeInstanceOf(ValidationError);
    await expect(adjust({ currentPeriodEnd: at(-5) })).rejects.toBeInstanceOf(ValidationError);
  });

  it("giving a cancelled business more time also cancels the deletion the system asked for", async () => {
    const planId = await newPlan();
    await paidTenant("tienda-a", planId, 1);
    now = at(100);
    await sweepSubscriptions(context, deps());
    expect((await tenantRow("tienda-a")).status).toBe("PENDING_DELETION");
    await adjustSubscription(
      { slug: "tienda-a", currentPeriodEnd: at(110), reason: "Pagó en efectivo, falta registrar" },
      context,
      deps(),
    );
    expect(await tenantRow("tienda-a")).toMatchObject({ status: "ACTIVE", deletionReason: null });
  });
});

describe("the daily sweep", () => {
  it("writes down each change of state once, and asks for the deletion of the cancelled", async () => {
    const planId = await newPlan();
    await paidTenant("al-corriente", planId, 200);
    await paidTenant("gracia", planId, 10);
    await paidTenant("lectura", planId, 2);
    await paidTenant("cancelada", planId, 2);
    await newTenant("prueba");
    await assignPlan({ slug: "prueba", planId, trial: true, reason: "Alta" }, context, deps());

    now = at(13);
    const first = await sweepSubscriptions(context, deps());
    expect(first.checked).toBe(5);
    const changed = Object.fromEntries(first.transitions.map((item) => [item.slug, item.to]));
    expect(changed).toEqual({ gracia: "PAST_DUE", lectura: "SUSPENDED", cancelada: "SUSPENDED" });
    expect(first.deletionsRequested).toEqual([]);
    expect((await audits("SUBSCRIPTION_PAST_DUE")).length).toBe(1);
    expect((await audits("SUBSCRIPTION_READ_ONLY")).length).toBe(2);

    // Repetirlo no cambia nada ni vuelve a escribir en la auditoría.
    const again = await sweepSubscriptions(context, deps());
    expect(again.transitions).toEqual([]);
    expect((await audits("SUBSCRIPTION_READ_ONLY")).length).toBe(2);

    now = at(75);
    const second = await sweepSubscriptions(context, deps());
    const later = Object.fromEntries(second.transitions.map((item) => [item.slug, item.to]));
    expect(later).toEqual({
      gracia: "SUSPENDED",
      lectura: "CANCELLED",
      cancelada: "CANCELLED",
      prueba: "SUSPENDED",
    });
    expect(second.deletionsRequested.sort()).toEqual(["cancelada", "lectura"]);
    expect(await tenantRow("cancelada")).toMatchObject({
      status: "PENDING_DELETION",
      deletionReason: BILLING_DELETION_REASON,
      statusBeforeDeletion: "ACTIVE",
    });
    expect((await tenantRow("cancelada")).deleteAfter).toEqual(at(75 + 30));
    expect((await audits("SUBSCRIPTION_CANCELLED")).length).toBe(2);
    expect((await audits("TENANT_DELETION_REQUESTED")).length).toBe(2);
    expect((await tenantRow("al-corriente")).status).toBe("ACTIVE");
    // Una prueba que venció sigue siendo prueba, aunque ya esté anotada como solo lectura.
    expect(await current("prueba")).toMatchObject({ isTrial: true, status: "SUSPENDED" });

    // Ya no se vuelve a pedir la baja de lo que ya la tiene.
    expect((await sweepSubscriptions(context, deps())).deletionsRequested).toEqual([]);
  });

  it("a payment brings a cancelled business back, and the next sweep leaves it alone", async () => {
    const planId = await newPlan();
    await paidTenant("tienda-a", planId, 1);
    now = at(100);
    await sweepSubscriptions(context, deps());
    expect((await tenantRow("tienda-a")).status).toBe("PENDING_DELETION");

    const result = await registerPayment(
      { slug: "tienda-a", amountCents: 90_000, method: "CASH" },
      context,
      deps(),
    );
    expect(result.deletionCancelled).toBe(true);
    const report = await sweepSubscriptions(context, deps());
    expect(report.transitions).toEqual([]);
    expect(report.deletionsRequested).toEqual([]);
    expect(await current("tienda-a")).toMatchObject({ status: "ACTIVE", isTrial: false });
    expect((await tenantRow("tienda-a")).status).toBe("ACTIVE");
  });

  it("also asks for the deletion of a manually suspended business whose subscription ended, but ignores the rest", async () => {
    const planId = await newPlan();
    await paidTenant("suspendida", planId, 1);
    await paidTenant("archivada", planId, 1);
    await controlTestDb.tenant.update({
      where: { slug: "suspendida" },
      data: { status: "SUSPENDED" },
    });
    await controlTestDb.tenant.update({
      where: { slug: "archivada" },
      data: { status: "DELETED" },
    });
    now = at(100);
    const report = await sweepSubscriptions(context, deps());
    expect(report.deletionsRequested).toEqual(["suspendida"]);
    expect(await tenantRow("suspendida")).toMatchObject({
      status: "PENDING_DELETION",
      statusBeforeDeletion: "SUSPENDED",
    });
    expect((await tenantRow("archivada")).status).toBe("DELETED");
  });

  it("a business without a subscription is never touched", async () => {
    await newTenant("sin-plan");
    now = at(1000);
    const report = await sweepSubscriptions(context, deps());
    expect(report).toEqual({ checked: 0, transitions: [], deletionsRequested: [] });
    expect((await tenantRow("sin-plan")).status).toBe("ACTIVE");
  });
});

describe("what needs attention", () => {
  it("lists who is cancelled, read-only, in grace or about to expire — most urgent first — and not who is fine", async () => {
    const planId = await newPlan();
    await paidTenant("al-corriente", planId, 187);
    await paidTenant("pronto", planId, 16);
    await paidTenant("gracia", planId, 10);
    await paidTenant("lectura", planId, 2);
    now = at(13);
    const { attention, total } = await billingOverview(deps());
    expect(total).toBe(4);
    expect(attention.map((row) => [row.slug, row.mode])).toEqual([
      ["lectura", "readonly"],
      ["gracia", "grace"],
      ["pronto", "full"],
    ]);
    expect(attention.find((row) => row.slug === "pronto")?.daysToPeriodEnd).toBe(3);
  });
});

describe("what the panel shows of one business", () => {
  it("gives the current subscription with its position, the history and the payments", async () => {
    const basic = await newPlan({ name: "Básico" });
    const full = await newPlan({ name: "Completo" });
    await paidTenant("tienda-a", basic, 5);
    await registerPayment(
      { slug: "tienda-a", amountCents: 90_000, method: "CASH" },
      context,
      deps(),
    );
    await changePlan(
      { slug: "tienda-a", planId: full, when: "now", reason: "Creció" },
      context,
      deps(),
    );
    const billing = await getTenantBilling("tienda-a", deps());
    expect(billing?.current).toMatchObject({
      plan: { name: "Completo" },
      isTrial: false,
      position: { mode: "full", status: "ACTIVE" },
    });
    expect(billing?.history).toHaveLength(1);
    expect(billing?.payments).toHaveLength(1);
    expect(await getTenantBilling("nadie", deps())).toBeNull();
  });
});

describe("constraints the database enforces by itself", () => {
  it("refuses impossible plans, subscriptions and payments even if the application had a bug", async () => {
    const planId = await newPlan();
    await paidTenant("tienda-a", planId, 10);
    const tenant = await tenantRow("tienda-a");
    const sub = await current("tienda-a");
    await expect(
      controlTestDb.plan.create({
        data: { name: "Negativo", priceCents: -1, interval: "MONTHLY", features: [] },
      }),
    ).rejects.toThrow();
    await expect(
      controlTestDb.subscription.update({ where: { id: sub.id }, data: { graceDays: 100 } }),
    ).rejects.toThrow();
    await expect(
      controlTestDb.subscription.update({
        where: { id: sub.id },
        data: { currentPeriodEnd: new Date(sub.currentPeriodStart.getTime() - DAY) },
      }),
    ).rejects.toThrow();
    await expect(
      controlTestDb.platformPayment.create({
        data: {
          tenantId: tenant.id,
          subscriptionId: sub.id,
          amountCents: 0,
          method: "CASH",
          paidAt: T0,
          coversFrom: T0,
          coversUntil: at(30),
        },
      }),
    ).rejects.toThrow();
  });
});
