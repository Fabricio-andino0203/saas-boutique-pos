"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { platformMessages } from "@/config/messages.platform.es";
import { useRefreshOnSuccess } from "@/modules/platform/components/use-redirect-on-state";
import { migrateFleetAction } from "@/modules/platform/tenant-actions";

const copy = platformMessages.tenants.review.migrateAll;

export function MigrateFleetForm() {
  const [state, formAction, pending] = useActionState(migrateFleetAction, undefined);
  useRefreshOnSuccess(state);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <label htmlFor="fleet-password" className="text-muted-foreground block text-xs">
          {platformMessages.tenants.actions.confirmPassword}
        </label>
        <Input
          id="fleet-password"
          name="actorPassword"
          type="password"
          autoComplete="current-password"
          className="w-48"
          required
        />
      </div>
      <Button type="submit" disabled={pending}>
        {copy.submit}
      </Button>
      {state?.error ? (
        <p role="alert" className="text-destructive w-full text-sm">
          {state.error}
        </p>
      ) : null}
      {state?.success ? (
        <p role="status" className="w-full text-sm text-green-700 dark:text-green-400">
          {state.success}
        </p>
      ) : null}
    </form>
  );
}
