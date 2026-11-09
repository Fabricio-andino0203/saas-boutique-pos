"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/shared/notice";
import { platformMessages } from "@/config/messages.platform.es";
import {
  deactivatePlatformUserAction,
  reactivatePlatformUserAction,
  resetPlatformUserTwoFactorAction,
  unlockPlatformUserAction,
} from "@/modules/platform/actions";
import { useRefreshOnSuccess } from "@/modules/platform/components/use-redirect-on-state";
import type { PlatformFormState } from "@/modules/platform/schemas";

const copy = platformMessages.admins.actions;

type RowAction = (previous: PlatformFormState, formData: FormData) => Promise<PlatformFormState>;

/** Una acción sobre otro administrador: se despliega, pide la contraseña de quien la hace y se confirma. */
function RowActionForm({
  userId,
  label,
  action,
  destructive = false,
}: {
  userId: string;
  label: string;
  action: RowAction;
  destructive?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  useRefreshOnSuccess(state);
  const fieldId = `confirm-${label}-${userId}`;

  return (
    <details className="group">
      <summary className="text-primary cursor-pointer text-sm">{label}</summary>
      <form action={formAction} className="mt-2 flex flex-wrap items-end gap-2">
        <input type="hidden" name="userId" value={userId} />
        <div className="space-y-1">
          <label htmlFor={fieldId} className="text-muted-foreground block text-sm">
            {copy.confirmPassword}
          </label>
          <Input
            id={fieldId}
            name="actorPassword"
            type="password"
            autoComplete="current-password"
            className="w-44"
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
        {state?.error ? (
          <Notice tone="error" size="sm" className="w-full">
            {state.error}
          </Notice>
        ) : null}
        {state?.success ? (
          <Notice tone="success" size="sm" className="w-full">
            {state.success}
          </Notice>
        ) : null}
      </form>
    </details>
  );
}

export function AdminRowActions({
  userId,
  isActive,
  isLocked,
}: {
  userId: string;
  isActive: boolean;
  isLocked: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      {isActive ? (
        <RowActionForm
          key="deactivate"
          userId={userId}
          label={copy.deactivate}
          action={deactivatePlatformUserAction}
          destructive
        />
      ) : (
        <RowActionForm
          key="reactivate"
          userId={userId}
          label={copy.reactivate}
          action={reactivatePlatformUserAction}
        />
      )}
      <RowActionForm
        key="reset2fa"
        userId={userId}
        label={copy.reset2fa}
        action={resetPlatformUserTwoFactorAction}
      />
      {isLocked ? (
        <RowActionForm
          key="unlock"
          userId={userId}
          label={copy.unlock}
          action={unlockPlatformUserAction}
        />
      ) : null}
    </div>
  );
}
