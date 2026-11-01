"use client";

import {
  useActionState,
  useEffect,
  useRef,
  useTransition,
  type FormEvent,
  type ReactNode,
} from "react";

import { NativeSelect } from "@/components/shared/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { platformMessages } from "@/config/messages.platform.es";
import {
  adjustSubscriptionAction,
  assignPlanAction,
  changePlanAction,
  registerPaymentAction,
} from "@/modules/platform/billing-actions";
import { useRefreshOnSuccess } from "@/modules/platform/components/use-redirect-on-state";
import type { PlatformFormState } from "@/modules/platform/schemas";

const copy = platformMessages.billing.subscription;

type Action = (previous: PlatformFormState, formData: FormData) => Promise<PlatformFormState>;

export type PlanOption = { id: string; name: string };

/** Una acción sobre la suscripción: se despliega, pide lo que necesita y la contraseña de quien la hace. */
function SubscriptionForm({
  slug,
  name,
  title,
  hint,
  submit,
  action,
  children,
}: {
  slug: string;
  name: string;
  title: string;
  hint?: string;
  submit: string;
  action: Action;
  children: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const [, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  useRefreshOnSuccess(state);
  const passwordId = `billing-${name}-password`;

  // Se envía a mano para que React NO reinicie el formulario al terminar: con una contraseña equivocada, lo escrito (el monto, la
  // referencia…) se conserva y solo se borra la contraseña. Tras un éxito sí se vacía todo, para no repetir el mismo cobro por descuido.
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  };
  useEffect(() => {
    if (state?.success) {
      formRef.current?.reset();
    } else if (state?.error) {
      const password = formRef.current?.elements.namedItem("actorPassword");
      if (password instanceof HTMLInputElement) {
        password.value = "";
      }
    }
  }, [state]);

  return (
    <details className="rounded-md border p-3" data-testid={`billing-${name}`}>
      <summary className="cursor-pointer text-sm font-medium">{title}</summary>
      <form ref={formRef} onSubmit={handleSubmit} className="mt-3 space-y-3">
        <input type="hidden" name="slug" value={slug} />
        {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
        <div className="grid gap-3 sm:grid-cols-2">{children}</div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label htmlFor={passwordId} className="text-muted-foreground block text-xs">
              {copy.actorPassword}
            </label>
            <Input
              id={passwordId}
              name="actorPassword"
              type="password"
              autoComplete="current-password"
              className="w-48"
              required
            />
          </div>
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            {submit}
          </Button>
        </div>
        {state?.error ? (
          <p role="alert" className="text-destructive text-sm">
            {state.error}
          </p>
        ) : null}
        {state?.success ? (
          <p role="status" className="text-sm text-green-700 dark:text-green-400">
            {state.success}
          </p>
        ) : null}
      </form>
    </details>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}

export function AssignPlanForm({ slug, plans }: { slug: string; plans: readonly PlanOption[] }) {
  const form = copy.assign;
  return (
    <SubscriptionForm
      slug={slug}
      name="assign"
      title={form.title}
      submit={form.submit}
      action={assignPlanAction}
    >
      <Field label={form.plan} id="assign-plan">
        <NativeSelect id="assign-plan" name="planId" required>
          {plans.map((plan) => (
            <option key={plan.id} value={plan.id}>
              {plan.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label={form.mode} id="assign-mode">
        <NativeSelect id="assign-mode" name="mode" defaultValue="trial">
          <option value="trial">{form.modeTrial}</option>
          <option value="paid">{form.modePaid}</option>
        </NativeSelect>
      </Field>
      <Field label={form.until} id="assign-until">
        <Input id="assign-until" name="until" type="date" />
        <p className="text-muted-foreground text-xs">{form.untilHint}</p>
      </Field>
      <Field label={form.reason} id="assign-reason">
        <Input id="assign-reason" name="reason" autoComplete="off" required minLength={3} />
      </Field>
    </SubscriptionForm>
  );
}

export function RegisterPaymentForm({ slug }: { slug: string }) {
  const form = copy.pay;
  return (
    <SubscriptionForm
      slug={slug}
      name="pay"
      title={form.title}
      hint={form.hint}
      submit={form.submit}
      action={registerPaymentAction}
    >
      <Field label={form.amount} id="pay-amount">
        <Input
          id="pay-amount"
          name="amount"
          inputMode="decimal"
          autoComplete="off"
          required
          placeholder="900.00"
        />
      </Field>
      <Field label={form.method} id="pay-method">
        <NativeSelect id="pay-method" name="method" defaultValue="TRANSFER">
          {Object.entries(platformMessages.billing.methods).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label={form.periods} id="pay-periods">
        <Input id="pay-periods" name="periods" type="number" min={1} max={24} defaultValue={1} />
      </Field>
      <Field label={form.paidAt} id="pay-paid-at">
        <Input id="pay-paid-at" name="paidAt" type="date" />
      </Field>
      <Field label={form.reference} id="pay-reference">
        <Input id="pay-reference" name="reference" autoComplete="off" maxLength={120} />
      </Field>
      <Field label={form.note} id="pay-note">
        <Input id="pay-note" name="note" autoComplete="off" maxLength={300} />
      </Field>
    </SubscriptionForm>
  );
}

export function ChangePlanForm({
  slug,
  plans,
  currentPlanId,
}: {
  slug: string;
  plans: readonly PlanOption[];
  currentPlanId: string;
}) {
  const form = copy.change;
  return (
    <SubscriptionForm
      slug={slug}
      name="change"
      title={form.title}
      hint={form.hint}
      submit={form.submit}
      action={changePlanAction}
    >
      <Field label={form.plan} id="change-plan">
        <NativeSelect id="change-plan" name="planId" required>
          {plans.map((plan) => (
            <option key={plan.id} value={plan.id} disabled={plan.id === currentPlanId}>
              {plan.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label={form.when} id="change-when">
        <NativeSelect id="change-when" name="when" defaultValue="now">
          <option value="now">{form.whenNow}</option>
          <option value="renewal">{form.whenRenewal}</option>
        </NativeSelect>
      </Field>
      <Field label={form.reason} id="change-reason">
        <Input id="change-reason" name="reason" autoComplete="off" required minLength={3} />
      </Field>
    </SubscriptionForm>
  );
}

export function AdjustSubscriptionForm({
  slug,
  periodEnd,
  graceDays,
  readOnlyDays,
}: {
  slug: string;
  /** `AAAA-MM-DD` en la zona de la tienda. */
  periodEnd: string;
  graceDays: number;
  readOnlyDays: number;
}) {
  const form = copy.adjust;
  return (
    <SubscriptionForm
      slug={slug}
      name="adjust"
      title={form.title}
      hint={form.hint}
      submit={form.submit}
      action={adjustSubscriptionAction}
    >
      <Field label={form.periodEnd} id="adjust-end">
        <Input id="adjust-end" name="periodEnd" type="date" defaultValue={periodEnd} required />
      </Field>
      <Field label={form.graceDays} id="adjust-grace">
        <Input
          id="adjust-grace"
          name="graceDays"
          type="number"
          min={0}
          max={90}
          defaultValue={graceDays}
          required
        />
      </Field>
      <Field label={form.readOnlyDays} id="adjust-readonly">
        <Input
          id="adjust-readonly"
          name="readOnlyDays"
          type="number"
          min={0}
          max={365}
          defaultValue={readOnlyDays}
          required
        />
      </Field>
      <Field label={form.reason} id="adjust-reason">
        <Input id="adjust-reason" name="reason" autoComplete="off" required minLength={3} />
      </Field>
    </SubscriptionForm>
  );
}
