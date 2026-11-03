"use client";

import { useActionState, useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/shared/notice";
import { platformMessages } from "@/config/messages.platform.es";
import { changePlatformPasswordAction } from "@/modules/platform/actions";

const copy = platformMessages.account;

export function PlatformChangePasswordForm() {
  const [state, formAction, pending] = useActionState(changePlatformPasswordAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.success) {
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="max-w-sm space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="currentPassword" className="text-sm font-medium">
          {copy.currentPassword}
        </label>
        <Input
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="newPassword" className="text-sm font-medium">
          {copy.newPassword}
        </label>
        <Input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="confirmPassword" className="text-sm font-medium">
          {copy.confirmPassword}
        </label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
        />
      </div>
      {state?.error ? <Notice tone="error">{state.error}</Notice> : null}
      {state?.success ? <Notice tone="success">{state.success}</Notice> : null}
      <Button type="submit" loading={pending}>
        {pending ? copy.submitting : copy.submit}
      </Button>
    </form>
  );
}
