import type { Plan, Prisma, Subscription } from "@/generated/control/client";
import {
  addDays,
  addMonths,
  BILLING_POLICY,
  computeBillingPosition,
  INTERVAL_MONTHS,
} from "@/lib/tenancy/billing";

type Tx = Prisma.TransactionClient;

/**
 * Abre la suscripción de un negocio (su primera, o la que reemplaza a otra ya cerrada). La usa el alta automática dentro de su
 * propia transacción. Una prueba dura los `trialDays` del plan; una suscripción sin prueba dura un periodo del plan.
 */
export async function startSubscription(
  tx: Tx,
  input: {
    tenantId: string;
    plan: Plan;
    trial: boolean;
    now: Date;
    periodEnd?: Date;
    reason?: string;
  },
): Promise<Subscription> {
  const { plan, now } = input;
  const periodEnd =
    input.periodEnd ??
    (input.trial ? addDays(now, plan.trialDays) : addMonths(now, INTERVAL_MONTHS[plan.interval]));
  const timing = {
    isTrial: input.trial,
    currentPeriodEnd: periodEnd,
    graceDays: BILLING_POLICY.graceDays,
    readOnlyDays: BILLING_POLICY.readOnlyDays,
  };
  return tx.subscription.create({
    data: {
      tenantId: input.tenantId,
      planId: plan.id,
      status: computeBillingPosition(timing, now).status,
      isTrial: input.trial,
      startsAt: now,
      // Un vencimiento ya pasado (se asigna un plan a un negocio que ya debía) empieza un periodo antes de ese vencimiento: la
      // base exige que el periodo termine después de empezar.
      currentPeriodStart:
        periodEnd < now ? addMonths(periodEnd, -INTERVAL_MONTHS[plan.interval]) : now,
      currentPeriodEnd: periodEnd,
      graceDays: timing.graceDays,
      readOnlyDays: timing.readOnlyDays,
      priceCentsSnapshot: plan.priceCents,
      intervalSnapshot: plan.interval,
      reason: input.reason ?? null,
    },
  });
}
