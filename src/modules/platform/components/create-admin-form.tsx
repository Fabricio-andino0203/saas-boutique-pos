"use client";

import { useActionState, useEffect, useRef } from "react";

import { FormField } from "@/components/shared/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { platformMessages } from "@/config/messages.platform.es";
import { createPlatformUserAction } from "@/modules/platform/actions";

const copy = platformMessages.admins.create;

export function CreateAdminForm() {
  const [state, formAction, pending] = useActionState(createPlatformUserAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.success) {
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="grid max-w-2xl gap-4 sm:grid-cols-2">
      <FormField label={copy.name} htmlFor="name">
        <Input id="name" name="name" autoComplete="off" required />
      </FormField>
      <FormField label={copy.username} htmlFor="new-username" hint={copy.usernameHint}>
        <Input id="new-username" name="username" autoComplete="off" required />
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
