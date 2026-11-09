"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/shared/notice";
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
        <label htmlFor="fleet-password" className="text-muted-foreground block text-sm">
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
      <Button type="submit" loading={pending}>
        {copy.submit}
      </Button>
      {state?.error ? (
        <Notice tone="error" className="w-full">
          {state.error}
        </Notice>
      ) : null}
      {state?.success ? (
        <Notice tone="success" className="w-full">
          {state.success}
        </Notice>
      ) : null}
    </form>
  );
}
