"use client";

import { useActionState, useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/shared/notice";
import { messages } from "@/config/messages.es";
import { changePasswordAction } from "@/modules/auth/actions";

const copy = messages.auth.account;

/** `forced`: se llegó aquí con una contraseña temporal; al guardar, el sistema sigue al inicio. */
export function ChangePasswordForm({ forced = false }: { forced?: boolean }) {
  const [state, formAction, pending] = useActionState(changePasswordAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.success) {
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="currentPassword" className="text-sm font-medium">
          {forced ? copy.forced.currentPassword : copy.currentPassword}
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
        {pending ? copy.submitting : forced ? copy.forced.submit : copy.submit}
      </Button>
    </form>
  );
}
