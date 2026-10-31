"use client";

import { useActionState } from "react";

import { FormField } from "@/components/shared/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { platformMessages } from "@/config/messages.platform.es";
import { createPlatformUserAction } from "@/modules/platform/actions";
import { useRefreshOnSuccess } from "@/modules/platform/components/use-redirect-on-state";

const copy = platformMessages.admins.create;

export function CreateAdminForm() {
  const [state, formAction, pending] = useActionState(createPlatformUserAction, undefined);
  useRefreshOnSuccess(state);

  // React reinicia el formulario al terminar la acción: con `defaultValue` tomado del resultado, un error no borra lo escrito.
  return (
    <form action={formAction} className="grid max-w-2xl gap-4 sm:grid-cols-2">
      <FormField label={copy.name} htmlFor="name">
        <Input
          id="name"
          name="name"
          autoComplete="off"
          defaultValue={state?.values?.name}
          required
        />
      </FormField>
      <FormField label={copy.username} htmlFor="new-username" hint={copy.usernameHint}>
        <Input
          id="new-username"
          name="username"
          autoComplete="off"
          defaultValue={state?.values?.username}
          required
        />
      </FormField>
      <FormField label={copy.password} htmlFor="new-password" hint={copy.passwordHint}>
        <Input
          id="new-password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
        />
      </FormField>
      <FormField label={copy.actorPassword} htmlFor="actorPassword">
        <Input
          id="actorPassword"
          name="actorPassword"
          type="password"
          autoComplete="current-password"
          required
        />
      </FormField>
      <div className="space-y-3 sm:col-span-2">
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
        <Button type="submit" disabled={pending}>
          {pending ? copy.submitting : copy.submit}
        </Button>
      </div>
    </form>
  );
}
