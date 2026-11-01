import { headers } from "next/headers";

import { platformMessages } from "@/config/messages.platform.es";
import { clientIpFrom } from "@/lib/client-ip";
import {
  AccountLockedError,
  AppError,
  InvalidCodeError,
  InvalidCredentialsError,
  type ErrorCode,
} from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { PlatformFormState } from "@/modules/platform/schemas";
import {
  assertPlatformNotThrottled,
  recordPlatformFailedAttempt,
} from "@/modules/platform/throttle";

/**
 * Piezas comunes de las acciones del panel que actúan sobre negocios (no es un archivo «use server»: no expone nada al
 * navegador, solo lo usan los archivos de acciones).
 */

export async function requestContext(): Promise<{ ip: string | undefined; userAgent?: string }> {
  const requestHeaders = await headers();
  const userAgent = requestHeaders.get("user-agent") ?? undefined;
  return { ip: clientIpFrom(requestHeaders), ...(userAgent ? { userAgent } : {}) };
}

/** Anota contra la IP los fallos que cuentan para el límite (contraseña, código o bloqueo) y deja pasar el error. */
export async function countingFailures<T>(
  ip: string | undefined,
  run: () => Promise<T>,
): Promise<T> {
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

/** Errores cuyo mensaje (ya en español, escrito por el servicio) se le muestra tal cual a quien opera. */
const SPECIFIC: ErrorCode[] = ["CONFLICT", "VALIDATION", "NOT_FOUND"];

/** El texto que ve quien opera: el del servicio si dice algo concreto, o el genérico de su tipo de error. */
export function messageFor(error: unknown): string {
  if (error instanceof AppError) {
    return SPECIFIC.includes(error.code)
      ? error.message
      : platformMessages.errors[error.code as keyof typeof platformMessages.errors];
  }
  logger.error("platform.action_unexpected", { error });
  return platformMessages.errors.UNEXPECTED;
}

/** Ejecuta `run` y devuelve el estado del formulario: `success` si sale bien, `error` (con el motivo concreto) si no. */
export async function asFormState(
  run: () => Promise<PlatformFormState>,
  values?: Record<string, string>,
): Promise<PlatformFormState> {
  try {
    return await run();
  } catch (error) {
    return { error: messageFor(error), ...(values ? { values } : {}) };
  }
}
