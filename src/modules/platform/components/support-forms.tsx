"use client";

import { useActionState, type ReactNode } from "react";

import { FormField } from "@/components/shared/form-field";
import { NativeSelect } from "@/components/shared/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/shared/notice";
import { platformMessages } from "@/config/messages.platform.es";
import { useRefreshOnSuccess } from "@/modules/platform/components/use-redirect-on-state";
import type { PlatformFormState } from "@/modules/platform/schemas";
import {
  closeSupportSessionAction,
  openSupportSessionAction,
  resetBusinessUserPasswordAction,
  unlockBusinessUserAction,
} from "@/modules/platform/support-actions";

const copy = platformMessages.support;

type Action = (previous: PlatformFormState, formData: FormData) => Promise<PlatformFormState>;

function Feedback({ state }: { state: PlatformFormState }) {
  return (
    <>
      {state?.error ? <Notice tone="error">{state.error}</Notice> : null}
      {state?.success ? <Notice tone="success">{state.success}</Notice> : null}
    </>
  );
}

function PasswordField({ id }: { id: string }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-muted-foreground block text-sm">
        {copy.actions.confirmPassword}
      </label>
      <Input
        id={id}
        name="actorPassword"
        type="password"
        autoComplete="current-password"
        className="w-48"
        required
      />
    </div>
  );
}

export function OpenSupportForm({ slug }: { slug: string }) {
  const [state, formAction, pending] = useActionState(openSupportSessionAction, undefined);
  useRefreshOnSuccess(state);
  const typed = state?.values;

  return (
    <form action={formAction} className="max-w-2xl space-y-3" data-testid="support-open-form">
      <input type="hidden" name="slug" value={slug} />
      <FormField label={copy.open.reason} htmlFor="support-reason" hint={copy.open.reasonHint}>
        <Input
          id="support-reason"
          name="reason"
          autoComplete="off"
          defaultValue={typed?.reason ?? ""}
          minLength={10}
          maxLength={300}
          required
        />
      </FormField>
      <FormField label={copy.open.minutes} htmlFor="support-minutes">
        <NativeSelect id="support-minutes" name="minutes" defaultValue={typed?.minutes ?? "30"}>
          {Object.entries(copy.open.options).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </NativeSelect>
      </FormField>
      <div className="flex flex-wrap items-end gap-2">
        <PasswordField id="support-open-password" />
        <Button type="submit" loading={pending}>
          {copy.open.submit}
        </Button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

export function CloseSupportForm({ slug }: { slug: string }) {
  const [state, formAction, pending] = useActionState(closeSupportSessionAction, undefined);
  useRefreshOnSuccess(state);

  return (
    <form action={formAction} className="space-y-3" data-testid="support-close-form">
      <input type="hidden" name="slug" value={slug} />
      <div className="flex flex-wrap items-end gap-2">
        <PasswordField id="support-close-password" />
        <Button type="submit" variant="outline" loading={pending}>
          {copy.current.close}
        </Button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

function UserActionForm({
  id,
  slug,
  userId,
  label,
  hint,
  action,
  children,
}: {
  id: string;
  slug: string;
  userId: string;
  label: string;
  hint: string;
  action: Action;
  children?: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  useRefreshOnSuccess(state);

  return (
    <details className="rounded-md border p-2" data-testid={id}>
      <summary className="cursor-pointer text-xs font-medium">{label}</summary>
      <form action={formAction} className="mt-2 space-y-2">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="userId" value={userId} />
        <p className="text-muted-foreground text-sm">{hint}</p>
        {children}
        <div className="flex flex-wrap items-end gap-2">
          <PasswordField id={`${id}-password`} />
          <Button type="submit" size="sm" variant="outline" loading={pending}>
            {label}
          </Button>
        </div>
        <Feedback state={state} />
      </form>
    </details>
  );
}

export function UnlockUserForm({ slug, userId }: { slug: string; userId: string }) {
  return (
    <UserActionForm
      id={`support-unlock-${userId}`}
      slug={slug}
      userId={userId}
      label={copy.actions.unlock}
      hint={copy.actions.unlockHint}
      action={unlockBusinessUserAction}
    />
  );
}

export function ResetPasswordForm({ slug, userId }: { slug: string; userId: string }) {
  return (
    <UserActionForm
      id={`support-reset-${userId}`}
      slug={slug}
      userId={userId}
      label={copy.actions.reset}
      hint={copy.actions.resetHint}
      action={resetBusinessUserPasswordAction}
    />
  );
}
