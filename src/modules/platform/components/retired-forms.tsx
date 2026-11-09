"use client";

import { useActionState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/shared/notice";
import { platformMessages } from "@/config/messages.platform.es";
import { useRefreshOnSuccess } from "@/modules/platform/components/use-redirect-on-state";
import {
  dropRetiredDatabaseAction,
  refreshUsageAction,
  requestFinalDumpAction,
} from "@/modules/platform/retired-actions";
import type { PlatformFormState } from "@/modules/platform/schemas";

const retired = platformMessages.backups.retired;

type Action = (previous: PlatformFormState, formData: FormData) => Promise<PlatformFormState>;

/** Una acción que pide la contraseña de quien la hace (y, si hace falta, algo más). */
function ConfirmForm({
  id,
  label,
  hint,
  action,
  hidden,
  destructive = false,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  action: Action;
  hidden: Record<string, string>;
  destructive?: boolean;
  children?: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  useRefreshOnSuccess(state);

  return (
    <details className="rounded-md border p-3" data-testid={id}>
      <summary className="cursor-pointer text-sm font-medium">{label}</summary>
      <form action={formAction} className="mt-3 space-y-3">
        {Object.entries(hidden).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        {hint ? <p className="text-muted-foreground text-sm">{hint}</p> : null}
        {children}
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label htmlFor={`${id}-password`} className="text-muted-foreground block text-sm">
              {platformMessages.backups.actions.confirmPassword}
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
          <Button
            type="submit"
            size="sm"
            variant={destructive ? "destructive" : "outline"}
            loading={pending}
          >
            {label}
          </Button>
        </div>
        {state?.error ? <Notice tone="error">{state.error}</Notice> : null}
        {state?.success ? <Notice tone="success">{state.success}</Notice> : null}
      </form>
    </details>
  );
}

export function FinalDumpForm({ database }: { database: string }) {
  return (
    <ConfirmForm
      id={`final-dump-${database}`}
      label={retired.requestDump}
      hint={retired.requestDumpHint}
      action={requestFinalDumpAction}
      hidden={{ database }}
    />
  );
}

export function DropDatabaseForm({ database }: { database: string }) {
  return (
    <ConfirmForm
      id={`drop-${database}`}
      label={retired.drop}
      hint={retired.dropHint}
      action={dropRetiredDatabaseAction}
      hidden={{ database }}
      destructive
    >
      <div className="space-y-1">
        <label htmlFor={`drop-${database}-confirm`} className="text-muted-foreground block text-sm">
          {retired.confirmName}
        </label>
        <Input id={`drop-${database}-confirm`} name="confirm" autoComplete="off" required />
      </div>
    </ConfirmForm>
  );
}

export function RefreshUsageForm({ slug }: { slug: string }) {
  return (
    <ConfirmForm
      id={`usage-refresh-${slug}`}
      label={platformMessages.usage.refresh}
      hint={platformMessages.usage.refreshHint}
      action={refreshUsageAction}
      hidden={{ slug }}
    />
  );
}
