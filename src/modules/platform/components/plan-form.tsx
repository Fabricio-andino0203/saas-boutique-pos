"use client";

import { useActionState } from "react";

import { FormField } from "@/components/shared/form-field";
import { NativeSelect } from "@/components/shared/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/shared/notice";
import { platformMessages } from "@/config/messages.platform.es";
import { PLAN_FEATURES, PLAN_LIMIT_KINDS } from "@/config/plan-catalog";
import { BILLING_INTERVALS } from "@/lib/tenancy/billing";
import { savePlanAction } from "@/modules/platform/billing-actions";
import {
  useRedirectOnState,
  useRefreshOnSuccess,
} from "@/modules/platform/components/use-redirect-on-state";

const copy = platformMessages.billing;
const form = copy.plans.form;

export type PlanFormDefaults = {
  id?: string;
  name: string;
  description: string;
  /** Precio en lempiras, como se escribe («900.00»). */
  price: string;
  interval: (typeof BILLING_INTERVALS)[number];
  trialDays: number;
  backupRetentionDays: number;
  sortOrder: number;
  isActive: boolean;
  limits: Partial<Record<(typeof PLAN_LIMIT_KINDS)[number], number | null>>;
  features: readonly string[];
};

export const EMPTY_PLAN: PlanFormDefaults = {
  name: "",
  description: "",
  price: "",
  interval: "MONTHLY",
  trialDays: 14,
  backupRetentionDays: 30,
  sortOrder: 0,
  isActive: true,
  limits: {},
  features: [],
};

const LIMIT_FIELDS = {
  users: "limitUsers",
  products: "limitProducts",
  terminals: "limitTerminals",
  locations: "limitLocations",
  photos: "limitPhotos",
} as const;

export function PlanForm({ defaults = EMPTY_PLAN }: { defaults?: PlanFormDefaults }) {
  const [state, formAction, pending] = useActionState(savePlanAction, undefined);
  useRedirectOnState(state);
  useRefreshOnSuccess(state);
  const editing = Boolean(defaults.id);
  // Con un error, lo que se había escrito se conserva (React reinicia el formulario al terminar la acción).
  const typed = state?.values;
  const checkedFeatures = typed ? typed.features?.split(",") : defaults.features;
  const isActive = typed ? typed.isActive === "on" : defaults.isActive;

  return (
    <form action={formAction} className="grid max-w-3xl gap-4 sm:grid-cols-2">
      {defaults.id ? <input type="hidden" name="id" value={defaults.id} /> : null}
      <FormField label={form.name} htmlFor="plan-name">
        <Input
          id="plan-name"
          name="name"
          autoComplete="off"
          defaultValue={typed?.name ?? defaults.name}
          required
        />
      </FormField>
      <FormField label={form.description} htmlFor="plan-description">
        <Input
          id="plan-description"
          name="description"
          autoComplete="off"
          defaultValue={typed?.description ?? defaults.description}
        />
      </FormField>
      <FormField label={form.price} htmlFor="plan-price" hint={form.priceHint}>
        <Input
          id="plan-price"
          name="price"
          inputMode="decimal"
          autoComplete="off"
          defaultValue={typed?.price ?? defaults.price}
          required
        />
      </FormField>
      <FormField label={form.interval} htmlFor="plan-interval">
        <NativeSelect
          id="plan-interval"
          name="interval"
          defaultValue={typed?.interval ?? defaults.interval}
        >
          {BILLING_INTERVALS.map((interval) => (
            <option key={interval} value={interval}>
              {copy.intervals[interval]}
            </option>
          ))}
        </NativeSelect>
      </FormField>
      <FormField label={form.trialDays} htmlFor="plan-trial" hint={form.trialHint}>
        <Input
          id="plan-trial"
          name="trialDays"
          type="number"
          min={0}
          max={365}
          defaultValue={typed?.trialDays ?? defaults.trialDays}
          required
        />
      </FormField>
      <FormField
        label={form.backupRetentionDays}
        htmlFor="plan-backup-days"
        hint={form.backupRetentionHint}
      >
        <Input
          id="plan-backup-days"
          name="backupRetentionDays"
          type="number"
          min={7}
          max={3650}
          defaultValue={typed?.backupRetentionDays ?? defaults.backupRetentionDays}
          required
        />
      </FormField>
      <FormField label={form.sortOrder} htmlFor="plan-sort">
        <Input
          id="plan-sort"
          name="sortOrder"
          type="number"
          min={0}
          max={1000}
          defaultValue={typed?.sortOrder ?? defaults.sortOrder}
          required
        />
      </FormField>

      <fieldset className="space-y-2 sm:col-span-2">
        <legend className="text-sm font-medium">{form.limits}</legend>
        <p className="text-muted-foreground text-sm">{form.limitsHint}</p>
        <div className="grid gap-3 sm:grid-cols-4">
          {PLAN_LIMIT_KINDS.map((kind) => {
            const name = LIMIT_FIELDS[kind];
            const initial = defaults.limits[kind];
            return (
              <FormField key={kind} label={copy.limitLabels[kind]} htmlFor={`plan-${name}`}>
                <Input
                  id={`plan-${name}`}
                  name={name}
                  type="number"
                  min={0}
                  placeholder={copy.unlimited}
                  defaultValue={typed?.[name] ?? (initial === null ? "" : initial)}
                />
              </FormField>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="space-y-2 sm:col-span-2">
        <legend className="text-sm font-medium">{form.features}</legend>
        <p className="text-muted-foreground text-sm">{copy.plans.coreIncluded}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {PLAN_FEATURES.map((feature) => (
            <label key={feature} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="features"
                value={feature}
                defaultChecked={checkedFeatures?.includes(feature) ?? false}
              />
              {copy.features[feature]}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="isActive" defaultChecked={isActive} />
        {form.isActive}
      </label>

      <FormField label={form.actorPassword} htmlFor="plan-actor-password">
        <Input
          id="plan-actor-password"
          name="actorPassword"
          type="password"
          autoComplete="current-password"
          required
        />
      </FormField>

      <div className="space-y-3 sm:col-span-2">
        {state?.error ? <Notice tone="error">{state.error}</Notice> : null}
        {state?.success ? <Notice tone="success">{state.success}</Notice> : null}
        <Button type="submit" loading={pending}>
          {pending ? form.saving : editing ? form.submitUpdate : form.submitCreate}
        </Button>
      </div>
    </form>
  );
}
