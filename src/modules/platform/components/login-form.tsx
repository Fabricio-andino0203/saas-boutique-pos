"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/shared/notice";
import { platformMessages } from "@/config/messages.platform.es";
import { platformLoginAction } from "@/modules/platform/actions";
import { useRedirectOnState } from "@/modules/platform/components/use-redirect-on-state";

const copy = platformMessages.login;

export function PlatformLoginForm() {
  const [state, formAction, pending] = useActionState(platformLoginAction, undefined);
  useRedirectOnState(state);

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="username" className="text-sm font-medium">
          {copy.username}
        </label>
        <Input id="username" name="username" autoComplete="username" required />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="password" className="text-sm font-medium">
          {copy.password}
        </label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      {state?.error ? <Notice tone="error">{state.error}</Notice> : null}
      <Button
        type="submit"
        className="h-11 w-full"
        disabled={pending || Boolean(state?.redirectTo)}
      >
        {pending || state?.redirectTo ? copy.submitting : copy.submit}
      </Button>
    </form>
  );
}
