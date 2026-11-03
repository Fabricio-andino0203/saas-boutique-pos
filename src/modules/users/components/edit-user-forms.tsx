"use client";

import { useActionState } from "react";

import { FormField } from "@/components/shared/form-field";
import { NativeSelect } from "@/components/shared/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/shared/notice";
import { messages } from "@/config/messages.es";
import { ROLES, type Role } from "@/lib/permissions";
import type { FormState } from "@/modules/auth/schemas";
import {
  resetPasswordAction,
  resetPinAction,
  setUserActiveAction,
  updateUserAction,
} from "@/modules/users/actions";

type EditableUser = { id: string; name: string; role: Role; isActive: boolean };

function Feedback({ state }: { state: FormState }) {
  if (state?.error) {
    return <Notice tone="error">{state.error}</Notice>;
  }
  if (state?.success) {
    return <Notice tone="success">{state.success}</Notice>;
  }
  return null;
}

function UpdateForm({ user, isSelf }: { user: EditableUser; isSelf: boolean }) {
  const [state, formAction, pending] = useActionState(
    updateUserAction.bind(null, user.id),
    undefined,
  );
  const copy = messages.users.form;
  return (
    <form action={formAction} className="space-y-4">
      <FormField label={copy.name} htmlFor="name">
        <Input id="name" name="name" defaultValue={user.name} autoComplete="off" required />
      </FormField>
      <FormField label={copy.role} htmlFor="role">
        <NativeSelect id="role" name="role" defaultValue={user.role} disabled={isSelf}>
          {ROLES.map((role) => (
            <option key={role} value={role}>
              {messages.auth.roles[role]}
            </option>
          ))}
        </NativeSelect>
        {isSelf ? <input type="hidden" name="role" value={user.role} /> : null}
      </FormField>
      <Feedback state={state} />
      <Button type="submit" loading={pending}>
        {pending ? copy.saving : copy.save}
      </Button>
    </form>
  );
}

function ActiveToggleForm({ user, isSelf }: { user: EditableUser; isSelf: boolean }) {
  const [state, formAction, pending] = useActionState(
    setUserActiveAction.bind(null, user.id, !user.isActive),
    undefined,
  );
  return (
    <form action={formAction} className="space-y-2">
      {user.isActive ? (
        <p className="text-muted-foreground text-sm">{messages.users.deactivateHint}</p>
      ) : null}
      <Feedback state={state} />
      <Button
        type="submit"
        variant={user.isActive ? "destructive" : "outline"}
        disabled={pending || (isSelf && user.isActive)}
      >
        {user.isActive ? messages.users.deactivate : messages.users.reactivate}
      </Button>
    </form>
  );
}

function ResetPasswordForm({ userId }: { userId: string }) {
  const [state, formAction, pending] = useActionState(
    resetPasswordAction.bind(null, userId),
    undefined,
  );
  const copy = messages.users.resetPassword;
  return (
    <form action={formAction} className="space-y-4">
      <FormField label={copy.label} htmlFor="newPassword" hint={messages.users.form.resetHint}>
        <Input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
        />
      </FormField>
      <Feedback state={state} />
      <Button type="submit" variant="outline" loading={pending}>
        {copy.submit}
      </Button>
    </form>
  );
}

function ResetPinForm({ userId }: { userId: string }) {
  const [state, formAction, pending] = useActionState(resetPinAction.bind(null, userId), undefined);
  const copy = messages.users.resetPin;
  return (
    <form action={formAction} className="space-y-4">
      <FormField label={copy.label} htmlFor="pin" hint={messages.users.form.pinHint}>
        <Input id="pin" name="pin" inputMode="numeric" autoComplete="off" required />
      </FormField>
      <Feedback state={state} />
      <Button type="submit" variant="outline" loading={pending}>
        {copy.submit}
      </Button>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-divider space-y-4 border-t pt-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function EditUserForms({ user, isSelf }: { user: EditableUser; isSelf: boolean }) {
  return (
    <div className="space-y-8">
      <UpdateForm user={user} isSelf={isSelf} />
      {isSelf ? null : (
        <>
          <Section title={messages.users.resetPassword.title}>
            <ResetPasswordForm userId={user.id} />
          </Section>
          <Section title={messages.users.resetPin.title}>
            <ResetPinForm userId={user.id} />
          </Section>
        </>
      )}
      <Section title={user.isActive ? messages.users.deactivate : messages.users.reactivate}>
        <ActiveToggleForm user={user} isSelf={isSelf} />
      </Section>
    </div>
  );
}
