"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { platformMessages } from "@/config/messages.platform.es";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { clientIpFrom } from "@/lib/client-ip";
import { AccountLockedError, InvalidCodeError, InvalidCredentialsError } from "@/lib/errors";
import {
  clearPlatformSession,
  readPlatformToken,
  requirePlatformSession,
  setPlatformSessionCookie,
} from "@/lib/platform-auth";
import {
  changePlatformPasswordSchema,
  createPlatformUserSchema,
  platformAdminActionSchema,
  platformLoginSchema,
  totpCodeSchema,
  type PlatformFormState,
} from "@/modules/platform/schemas";
import {
  changePlatformPassword,
  completeEnrollment,
  confirmActorPassword,
  createPlatformUser,
  loginWithPassword,
  resetPlatformUserTwoFactor,
  setPlatformUserActive,
  unlockPlatformUser,
  verifyLoginCode,
} from "@/modules/platform/service";
import {
  assertPlatformNotThrottled,
  recordPlatformFailedAttempt,
} from "@/modules/platform/throttle";

const errorMessages = platformMessages.errors;

async function requestContext() {
  const requestHeaders = await headers();
  return {
    ip: clientIpFrom(requestHeaders),
    userAgent: requestHeaders.get("user-agent") ?? undefined,
  };
}

/** Anota contra la IP los fallos que cuentan para el límite (credenciales, código o bloqueo) y deja pasar el error. */
async function countingFailures<T>(ip: string | undefined, run: () => Promise<T>): Promise<T> {
  assertPlatformNotThrottled(ip);
  try {
    return await run();
  } catch (error) {
    if (
      error instanceof InvalidCredentialsError ||
      error instanceof InvalidCodeError ||
      error instanceof AccountLockedError
    ) {
      recordPlatformFailedAttempt(ip, error.code);
    }
    throw error;
  }
}

// ───────────────────────────── Entrada ─────────────────────────────

export async function platformLoginAction(
  _previous: PlatformFormState,
  formData: FormData,
): Promise<PlatformFormState> {
  const parsed = platformLoginSchema.safeParse({
    username: formData.get("username"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: platformMessages.login.required };
  }
  const context = await requestContext();
  const result = await toActionResult(
    () => countingFailures(context.ip, () => loginWithPassword({ ...parsed.data, ...context })),
    errorMessages,
  );
  if (!result.ok) {
    return { error: result.error.message };
  }
  await setPlatformSessionCookie(result.data.token, result.data.expires);
  redirect(result.data.next === "enroll" ? "/login/configurar" : "/login/verificar");
}

/** Resultado común de los dos pasos que abren la sesión completa. */
async function finishLogin(
  result: ActionResult<{ token: string; expires: Date }>,
): Promise<PlatformFormState> {
  if (!result.ok) {
    if (result.error.code === "UNAUTHORIZED") {
      redirect("/login"); // el paso de la contraseña venció: se empieza de nuevo
    }
    return { error: result.error.message };
  }
  await setPlatformSessionCookie(result.data.token, result.data.expires);
  redirect("/");
}

export async function platformVerifyCodeAction(
  _previous: PlatformFormState,
  formData: FormData,
): Promise<PlatformFormState> {
  const parsed = totpCodeSchema.safeParse({ code: formData.get("code") ?? "" });
  if (!parsed.success) {
    return { error: platformMessages.verify.invalid };
  }
  const token = await readPlatformToken();
  if (!token) {
    redirect("/login");
  }
  const context = await requestContext();
  const result = await toActionResult(
    () =>
      countingFailures(context.ip, () =>
        verifyLoginCode({ token, code: parsed.data.code, ...context }),
      ),
    errorMessages,
  );
  return finishLogin(result);
}

export async function platformEnrollAction(
  _previous: PlatformFormState,
  formData: FormData,
): Promise<PlatformFormState> {
  const parsed = totpCodeSchema.safeParse({ code: formData.get("code") ?? "" });
  if (!parsed.success) {
    return { error: platformMessages.verify.invalid };
  }
  const token = await readPlatformToken();
  if (!token) {
    redirect("/login");
  }
  const context = await requestContext();
  const result = await toActionResult(
    () =>
      countingFailures(context.ip, () =>
        completeEnrollment({ token, code: parsed.data.code, ...context }),
      ),
    errorMessages,
  );
  return finishLogin(result);
}

export async function platformLogoutAction(): Promise<void> {
  const { ip } = await requestContext();
  await clearPlatformSession({ ip });
  redirect("/login");
}

// ───────────────────────────── Administradores ─────────────────────────────

export async function createPlatformUserAction(
  _previous: PlatformFormState,
  formData: FormData,
): Promise<PlatformFormState> {
  const parsed = createPlatformUserSchema.safeParse({
    name: formData.get("name"),
    username: formData.get("username"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? platformMessages.validation.required };
  }
  const actorPassword = String(formData.get("actorPassword") ?? "");
  const session = await requirePlatformSession();
  const context = await requestContext();
  const actor = { id: session.user.id, username: session.user.username };

  const result = await toActionResult(
    () =>
      countingFailures(context.ip, async () => {
        await confirmActorPassword(actor.id, actorPassword, context);
        return createPlatformUser(parsed.data, { actor, ip: context.ip });
      }),
    errorMessages,
  );
  return result.ok
    ? { success: platformMessages.admins.create.success }
    : { error: result.error.message };
}

type RowAction = "deactivate" | "reactivate" | "reset2fa" | "unlock";

async function runRowAction(formData: FormData, action: RowAction): Promise<PlatformFormState> {
  const parsed = platformAdminActionSchema.safeParse({
    userId: formData.get("userId"),
    actorPassword: formData.get("actorPassword"),
  });
  if (!parsed.success) {
    return { error: platformMessages.validation.required };
  }
  const session = await requirePlatformSession();
  const context = await requestContext();
  const actor = { id: session.user.id, username: session.user.username };
  const adminContext = { actor, ip: context.ip };

  const result = await toActionResult(
    () =>
      countingFailures(context.ip, async () => {
        await confirmActorPassword(actor.id, parsed.data.actorPassword, context);
        switch (action) {
          case "deactivate":
            return setPlatformUserActive(
              { userId: parsed.data.userId, active: false },
              adminContext,
            );
          case "reactivate":
            return setPlatformUserActive(
              { userId: parsed.data.userId, active: true },
              adminContext,
            );
          case "reset2fa":
            return resetPlatformUserTwoFactor(parsed.data.userId, adminContext);
          case "unlock":
            return unlockPlatformUser(parsed.data.userId, adminContext);
        }
      }),
    errorMessages,
  );
  if (!result.ok) {
    return { error: result.error.message };
  }
  const done = platformMessages.admins.actions;
  return {
    success: {
      deactivate: done.deactivated,
      reactivate: done.reactivated,
      reset2fa: done.reset2faDone,
      unlock: done.unlocked,
    }[action],
  };
}

export async function deactivatePlatformUserAction(
  _previous: PlatformFormState,
  formData: FormData,
): Promise<PlatformFormState> {
  return runRowAction(formData, "deactivate");
}

export async function reactivatePlatformUserAction(
  _previous: PlatformFormState,
  formData: FormData,
): Promise<PlatformFormState> {
  return runRowAction(formData, "reactivate");
}

export async function resetPlatformUserTwoFactorAction(
  _previous: PlatformFormState,
  formData: FormData,
): Promise<PlatformFormState> {
  return runRowAction(formData, "reset2fa");
}

export async function unlockPlatformUserAction(
  _previous: PlatformFormState,
  formData: FormData,
): Promise<PlatformFormState> {
  return runRowAction(formData, "unlock");
}

export async function changePlatformPasswordAction(
  _previous: PlatformFormState,
  formData: FormData,
): Promise<PlatformFormState> {
  const parsed = changePlatformPasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? platformMessages.validation.required };
  }
  const session = await requirePlatformSession();
  const context = await requestContext();
  const result = await toActionResult(
    () =>
      countingFailures(context.ip, () =>
        changePlatformPassword(
          {
            userId: session.user.id,
            currentPassword: parsed.data.currentPassword,
            newPassword: parsed.data.newPassword,
            keepSessionId: session.sessionId,
          },
          context,
        ),
      ),
    { ...errorMessages, INVALID_CREDENTIALS: platformMessages.account.wrongCurrent },
  );
  return result.ok
    ? { success: platformMessages.account.success }
    : { error: result.error.message };
}
