"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { messages } from "@/config/messages.es";
import { toActionResult } from "@/lib/action-result";
import { clearSession, requireSession, requireUserCapability, setSessionCookie } from "@/lib/auth";
import { safeNextPath } from "@/lib/session-cookie";
import { changePasswordSchema, loginSchema, type FormState } from "@/modules/auth/schemas";
import { AccountLockedError, ForbiddenError, InvalidCredentialsError } from "@/lib/errors";
import { changePassword, login, switchUserWithPin } from "@/modules/auth/service";

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

/** Cambia al cajero que está en el mostrador con su usuario y PIN, sin tocar el ticket armado en el navegador. */
export async function switchCashierAction(input: {
  username: string;
  pin: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const copy = messages.pos.switch;
  const username = String(input.username ?? "").trim();
  const pin = String(input.pin ?? "");
  if (username === "" || !/^\d{4,6}$/.test(pin)) {
    return { ok: false, message: copy.invalid };
  }
  const { sessionId } = await requireUserCapability("sale.create");
  const requestHeaders = await headers();
  try {
    const result = await switchUserWithPin({
      username,
      pin,
      currentSessionId: sessionId,
      ip: requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined,
      userAgent: requestHeaders.get("user-agent") ?? undefined,
    });
    await setSessionCookie(result.token, result.expires);
    return { ok: true };
  } catch (error) {
    if (error instanceof InvalidCredentialsError) {
      return { ok: false, message: copy.invalid };
    }
    if (error instanceof AccountLockedError) {
      return { ok: false, message: messages.errors.ACCOUNT_LOCKED };
    }
    if (error instanceof ForbiddenError) {
      return { ok: false, message: copy.cannotSell };
    }
    console.error("Error inesperado al cambiar de cajero", error);
    return { ok: false, message: messages.errors.UNEXPECTED };
  }
}
