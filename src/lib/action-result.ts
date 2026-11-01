import { AppError, type ErrorCode } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { currentTenantLabel } from "@/lib/tenancy/resolver";

export type ActionErrorCode = ErrorCode | "UNEXPECTED";

export type ActionError = { code: ActionErrorCode; message: string };

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ActionError };

export type ErrorMessages = Record<ActionErrorCode, string>;

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail(code: ActionErrorCode, message: string): ActionResult<never> {
  return { ok: false, error: { code, message } };
}

/** Multi-negocio: la línea lleva el negocio de la petición (en `single` no hay `tenant`, como siempre). */
function logUnexpected(error: unknown): void {
  void currentTenantLabel().then((tenant) => logger.error("action.unexpected", { tenant, error }));
}

export async function toActionResult<T>(
  fn: () => T | Promise<T>,
  messages: ErrorMessages,
  onUnexpected: (error: unknown) => void = logUnexpected,
): Promise<ActionResult<T>> {
  try {
    return ok(await fn());
  } catch (error) {
    if (error instanceof AppError) {
      return fail(error.code, messages[error.code]);
    }
    onUnexpected(error);
    return fail("UNEXPECTED", messages.UNEXPECTED);
  }
}
