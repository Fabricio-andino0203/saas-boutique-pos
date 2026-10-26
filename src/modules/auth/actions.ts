"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { messages } from "@/config/messages.es";
import { toActionResult } from "@/lib/action-result";
import { clearSession, requireSession, setSessionCookie } from "@/lib/auth";
import { safeNextPath } from "@/lib/session-cookie";
import { changePasswordSchema, loginSchema, type FormState } from "@/modules/auth/schemas";
import { changePassword, login } from "@/modules/auth/service";

export async function loginAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({
    username: formData.get("username"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: messages.auth.validation.required };
  }

  const requestHeaders = await headers();
  const result = await toActionResult(
    () =>
      login({
        ...parsed.data,
        ip: requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined,
        userAgent: requestHeaders.get("user-agent") ?? undefined,
      }),
    messages.errors,
  );
  if (!result.ok) {
    return { error: result.error.message };
  }

  await setSessionCookie(result.data.token, result.data.expires);
  redirect(safeNextPath(formData.get("next")));
}

export async function logoutAction(): Promise<void> {
  await clearSession();
  redirect("/login");
}

export async function changePasswordAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? messages.errors.VALIDATION };
  }

  const session = await requireSession();
  const result = await toActionResult(
    () =>
      changePassword({
        userId: session.user.id,
        currentPassword: parsed.data.currentPassword,
        newPassword: parsed.data.newPassword,
        keepSessionId: session.sessionId,
      }),
    { ...messages.errors, INVALID_CREDENTIALS: messages.auth.account.wrongCurrent },
  );
  if (!result.ok) {
    return { error: result.error.message };
  }
  return { success: messages.auth.account.success };
}
