"use client";

import { useActionState } from "react";

import { FormField } from "@/components/shared/form-field";
import { NativeSelect } from "@/components/shared/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/shared/notice";
import { platformMessages } from "@/config/messages.platform.es";
import {
  useRedirectOnState,
  useRefreshOnSuccess,
} from "@/modules/platform/components/use-redirect-on-state";
import { provisionTenantAction } from "@/modules/platform/tenant-actions";

const copy = platformMessages.tenants.create;

export function CreateTenantForm({
  baseDomain,
  plans,
}: {
  baseDomain: string | undefined;
  plans: readonly { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(provisionTenantAction, undefined);
  useRedirectOnState(state);
  useRefreshOnSuccess(state);

  // React reinicia el formulario al terminar la acción: con `defaultValue` tomado del resultado, un error no borra lo escrito.
  return (
    <form action={formAction} className="grid max-w-3xl gap-4 sm:grid-cols-2">
      <FormField label={copy.name} htmlFor="tenant-name">
        <Input
          id="tenant-name"
          name="name"
          autoComplete="off"
          defaultValue={state?.values?.name}
          required
        />
      </FormField>
      <FormField
        label={copy.slug}
        htmlFor="tenant-slug"
        hint={`${copy.slugHint} <subdominio>${baseDomain ? `.${baseDomain}` : ""}`}
      >
        <Input
          id="tenant-slug"
          name="slug"
          autoComplete="off"
          defaultValue={state?.values?.slug}
          required
        />
      </FormField>
      <FormField label={copy.ownerName} htmlFor="tenant-owner-name">
        <Input
          id="tenant-owner-name"
          name="ownerName"
          autoComplete="off"
          defaultValue={state?.values?.ownerName}
          required
        />
      </FormField>
      <FormField
        label={copy.ownerUsername}
        htmlFor="tenant-owner-username"
        hint={copy.ownerUsernameHint}
      >
        <Input
          id="tenant-owner-username"
          name="ownerUsername"
          autoComplete="off"
          defaultValue={state?.values?.ownerUsername}
          required
        />
      </FormField>
      <FormField label={copy.ownerEmail} htmlFor="tenant-owner-email">
        <Input
          id="tenant-owner-email"
          name="ownerEmail"
          type="email"
          autoComplete="off"
          defaultValue={state?.values?.ownerEmail}
        />
      </FormField>
      <FormField
        label={copy.ownerPassword}
        htmlFor="tenant-owner-password"
        hint={copy.ownerPasswordHint}
      >
        <Input
          id="tenant-owner-password"
          name="ownerPassword"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </FormField>
      <FormField label={copy.plan} htmlFor="tenant-plan" hint={copy.planHint}>
        <NativeSelect id="tenant-plan" name="planId" defaultValue={state?.values?.planId ?? ""}>
          <option value="">{copy.noPlan}</option>
          {plans.map((plan) => (
            <option key={plan.id} value={plan.id}>
              {plan.name}
            </option>
          ))}
        </NativeSelect>
      </FormField>
      <FormField label={copy.actorPassword} htmlFor="tenant-actor-password">
        <Input
          id="tenant-actor-password"
          name="actorPassword"
          type="password"
          autoComplete="current-password"
          required
        />
      </FormField>
      <div className="space-y-3 sm:col-span-2">
        {state?.error ? <Notice tone="error">{state.error}</Notice> : null}
        <Button type="submit" loading={pending}>
          {pending ? copy.submitting : copy.submit}
        </Button>
      </div>
    </form>
  );
}
