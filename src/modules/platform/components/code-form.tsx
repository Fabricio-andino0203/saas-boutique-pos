"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { platformMessages } from "@/config/messages.platform.es";
import { platformEnrollAction, platformVerifyCodeAction } from "@/modules/platform/actions";

/** Campo del código de 6 dígitos: sirve para entrar (`verify`) y para activar la aplicación por primera vez (`enroll`). */
export function CodeForm({ mode }: { mode: "verify" | "enroll" }) {
  const copy = mode === "verify" ? platformMessages.verify : platformMessages.enroll;
  const [state, formAction, pending] = useActionState(
    mode === "verify" ? platformVerifyCodeAction : platformEnrollAction,
    undefined,
  );

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="code" className="text-sm font-medium">
          {platformMessages.verify.code}
        </label>
        <Input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]{6,7}"
          maxLength={7}
          className="text-center text-lg tracking-[0.4em]"
          autoFocus
          required
        />
      </div>
      {state?.error ? (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" className="h-11 w-full" disabled={pending}>
        {pending ? copy.submitting : copy.submit}
      </Button>
    </form>
  );
}
