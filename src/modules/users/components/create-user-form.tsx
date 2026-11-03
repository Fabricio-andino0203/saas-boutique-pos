"use client";

import { useActionState } from "react";

import { FormField } from "@/components/shared/form-field";
import { NativeSelect } from "@/components/shared/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/shared/notice";
import { messages } from "@/config/messages.es";
import { ROLES } from "@/lib/permissions";
import { createUserAction } from "@/modules/users/actions";

const copy = messages.users.form;

export function CreateUserForm() {
  const [state, formAction, pending] = useActionState(createUserAction, undefined);

  return (
    <form action={formAction} className="space-y-4">
      <FormField label={copy.name} htmlFor="name">
        <Input id="name" name="name" autoComplete="off" required />
      </FormField>
      <FormField label={copy.username} htmlFor="username" hint={copy.usernameHint}>
        <Input id="username" name="username" autoComplete="off" required />
      </FormField>
      <FormField label={copy.role} htmlFor="role">
        <NativeSelect id="role" name="role" defaultValue="CASHIER">
          {ROLES.map((role) => (
            <option key={role} value={role}>
              {messages.auth.roles[role]}
            </option>
          ))}
        </NativeSelect>
      </FormField>
      <FormField label={copy.password} htmlFor="password" hint={copy.passwordHint}>
        <Input id="password" name="password" type="password" autoComplete="new-password" required />
      </FormField>
      <FormField label={copy.pin} htmlFor="pin" hint={copy.pinHint}>
        <Input id="pin" name="pin" inputMode="numeric" autoComplete="off" />
      </FormField>
      {state?.error ? <Notice tone="error">{state.error}</Notice> : null}
      <Button type="submit" loading={pending}>
        {pending ? copy.creating : copy.create}
      </Button>
    </form>
  );
}
