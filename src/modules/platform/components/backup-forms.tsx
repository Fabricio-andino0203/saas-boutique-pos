"use client";

import { useActionState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/shared/notice";
import { platformMessages } from "@/config/messages.platform.es";
import {
  relinkTenantAction,
  requestBackupAction,
  requestControlBackupAction,
} from "@/modules/platform/backup-actions";
import { useRefreshOnSuccess } from "@/modules/platform/components/use-redirect-on-state";
import type { PlatformFormState } from "@/modules/platform/schemas";

const copy = platformMessages.backups;

type Action = (previous: PlatformFormState, formData: FormData) => Promise<PlatformFormState>;

/** Una acción que pide solo la contraseña de quien la hace. */
function PasswordForm({
  id,
  label,
  hint,
  action,
  slug,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  action: Action;
  slug?: string;
  children?: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  useRefreshOnSuccess(state);

  return (
    <details className="rounded-md border p-3" data-testid={id}>
      <summary className="cursor-pointer text-sm font-medium">{label}</summary>
      <form action={formAction} className="mt-3 space-y-3">
        {slug ? <input type="hidden" name="slug" value={slug} /> : null}
        {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
        {children}
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label htmlFor={`${id}-password`} className="text-muted-foreground block text-xs">
              {copy.actions.confirmPassword}
            </label>
            <Input
              id={`${id}-password`}
              name="actorPassword"
              type="password"
              autoComplete="current-password"
              className="w-48"
              required
            />
          </div>
          <Button type="submit" size="sm" variant="outline" loading={pending}>
            {label}
          </Button>
        </div>
        {state?.error ? <Notice tone="error">{state.error}</Notice> : null}
        {state?.success ? <Notice tone="success">{state.success}</Notice> : null}
      </form>
    </details>
  );
}

export function RequestBackupForm({ slug }: { slug: string }) {
  return (
    <PasswordForm
      id={`backup-request-${slug}`}
      label={copy.detail.requestNow}
      hint={copy.detail.requestHint}
      action={requestBackupAction}
      slug={slug}
    />
  );
}

export function RelinkForm({ slug }: { slug: string }) {
  return (
    <PasswordForm
      id={`relink-${slug}`}
      label={copy.detail.relink}
      hint={copy.detail.relinkHint}
      action={relinkTenantAction}
      slug={slug}
    />
  );
}

export function RequestControlBackupForm() {
  return (
    <PasswordForm
      id="backup-request-control"
      label={copy.actions.requestControl}
      hint={copy.detail.requestHint}
      action={requestControlBackupAction}
    />
  );
}
