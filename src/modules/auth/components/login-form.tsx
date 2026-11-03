"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/shared/notice";
import { messages } from "@/config/messages.es";
import { loginAction } from "@/modules/auth/actions";

export function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(loginAction, undefined);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <div className="space-y-1.5">
        <label htmlFor="username" className="text-sm font-medium">
          {messages.auth.login.username}
        </label>
        <Input id="username" name="username" autoComplete="username" required />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="password" className="text-sm font-medium">
          {messages.auth.login.password}
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
      <Button type="submit" className="h-11 w-full" loading={pending}>
        {pending ? messages.auth.login.submitting : messages.auth.login.submit}
      </Button>
    </form>
  );
}
