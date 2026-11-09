import type { ReactNode } from "react";

import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { platformMessages } from "@/config/messages.platform.es";
import { formatLocalDate, localDateKey } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { getTenantBilling, listPlans } from "@/modules/platform/billing";
import {
  AdjustSubscriptionForm,
  AssignPlanForm,
  ChangePlanForm,
  RegisterPaymentForm,
} from "@/modules/platform/components/subscription-forms";

const copy = platformMessages.billing;
const sub = copy.subscription;

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

/** La suscripción de un negocio: qué plan tiene, hasta cuándo está pagado, las acciones para cobrar y cambiar, y el historial. */
export async function TenantSubscription({
  slug,
  tenantStatus,
}: {
  slug: string;
  /** Estado del negocio (`TenantStatus`): a quien está dado de baja o sin terminar de crear no se le ofrecen acciones. */
  tenantStatus: string;
}) {
  if (tenantStatus === "DELETED") {
    return null;
  }
  const [billing, plans] = await Promise.all([getTenantBilling(slug), listPlans()]);
  if (!billing) {
    return null;
  }
  const { current } = billing;
  const activePlans = plans.filter((plan) => plan.isActive).map(({ id, name }) => ({ id, name }));
  const canEdit = tenantStatus !== "PROVISIONING" && tenantStatus !== "FAILED";

  return (
    <section aria-labelledby="subscription-title" className="space-y-4">
      <h2 id="subscription-title" className="text-lg font-semibold">
        {sub.title}
      </h2>

      {current ? (
        <dl
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          data-testid="subscription-facts"
          data-mode={current.position.mode}
        >
          <Fact label={sub.facts.plan}>
            {current.plan.name}
            {current.isTrial ? ` (${sub.trialTag})` : ""}
          </Fact>
          <Fact label={sub.facts.state}>
            {copy.statuses[current.position.status]} · {copy.modes[current.position.mode]}
          </Fact>
          <Fact label={sub.facts.access}>{sub.accessLabels[current.position.mode]}</Fact>
          <Fact label={sub.facts.price}>
            {formatMoney(current.priceCentsSnapshot)} · {copy.intervals[current.intervalSnapshot]}
          </Fact>
          <Fact label={sub.facts.periodEnd}>{formatLocalDate(current.position.periodEnd)}</Fact>
          <Fact label={sub.facts.graceEnds}>
            {formatLocalDate(current.position.graceEndsAt)} ({current.graceDays} días)
          </Fact>
          <Fact label={sub.facts.readOnlyEnds}>
            {formatLocalDate(current.position.readOnlyEndsAt)} ({current.readOnlyDays} días)
          </Fact>
          {current.nextPlan ? (
            <Fact label={sub.facts.nextPlan}>{current.nextPlan.name}</Fact>
          ) : null}
        </dl>
      ) : (
        <p className="text-muted-foreground max-w-3xl text-sm" data-testid="subscription-none">
          {sub.none}
        </p>
      )}

      {canEdit ? (
        <div className="grid max-w-3xl gap-3">
          {current ? (
            <>
              <RegisterPaymentForm slug={slug} />
              <ChangePlanForm slug={slug} plans={activePlans} currentPlanId={current.plan.id} />
              <AdjustSubscriptionForm
                slug={slug}
                periodEnd={localDateKey(current.position.periodEnd)}
                graceDays={current.graceDays}
                readOnlyDays={current.readOnlyDays}
              />
            </>
          ) : activePlans.length > 0 ? (
            <AssignPlanForm slug={slug} plans={activePlans} />
          ) : null}
        </div>
      ) : null}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">{sub.payments}</h3>
        {billing.payments.length === 0 ? (
          <p className="text-muted-foreground text-sm">{sub.paymentsEmpty}</p>
        ) : (
          <Table>
            <TableCaption className="sr-only">{sub.payments}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>{sub.columns.date}</TableHead>
                <TableHead>{sub.columns.amount}</TableHead>
                <TableHead>{sub.columns.method}</TableHead>
                <TableHead>{sub.columns.reference}</TableHead>
                <TableHead>{sub.columns.covers}</TableHead>
                <TableHead>{sub.columns.by}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {billing.payments.map((payment) => (
                <TableRow key={payment.id}>
                  <TableCell className="whitespace-nowrap">
                    {formatLocalDate(payment.paidAt)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatMoney(payment.amountCents)}
                  </TableCell>
                  <TableCell>{copy.methods[payment.method]}</TableCell>
                  <TableCell>{payment.reference ?? "—"}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatLocalDate(payment.coversUntil)}
                  </TableCell>
                  <TableCell>
                    {payment.registeredByUsername ? `@${payment.registeredByUsername}` : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {billing.history.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">{sub.history}</h3>
          <Table>
            <TableCaption className="sr-only">{sub.history}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>{sub.columns.plan}</TableHead>
                <TableHead>{sub.columns.from}</TableHead>
                <TableHead>{sub.columns.until}</TableHead>
                <TableHead>{sub.columns.price}</TableHead>
                <TableHead>{sub.columns.reason}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {billing.history.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.plan.name}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatLocalDate(row.startsAt)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {row.endedAt ? formatLocalDate(row.endedAt) : "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatMoney(row.priceCentsSnapshot)}
                  </TableCell>
                  <TableCell>{row.reason ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </section>
  );
}
