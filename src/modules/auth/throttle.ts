import { env } from "@/lib/env";
import { TooManyAttemptsError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { sharedRateLimiter, type RateLimiter } from "@/lib/rate-limit";

const WINDOW_MS = 15 * 60_000;
const UNKNOWN_IP = "unknown";

/** Un limitador para inicio de sesión y cambio de cajero por PIN: por defecto 20 fallos por IP cada 15 minutos. */
export function loginLimiter(): RateLimiter {
  return sharedRateLimiter("login", { max: env.LOGIN_RATE_LIMIT_MAX, windowMs: WINDOW_MS });
}

/** Lanza `TooManyAttemptsError` si esa IP ya agotó sus intentos fallidos. Llamar ANTES de revisar credenciales. */
export function assertNotThrottled(
  ip: string | undefined,
  limiter: RateLimiter = loginLimiter(),
): void {
  const status = limiter.check(ip ?? UNKNOWN_IP);
  if (status.blocked) {
    logger.warn("auth.rate_limited", { ip, retryAfterSeconds: status.retryAfterSeconds });
    throw new TooManyAttemptsError("Too many failed attempts", {
      retryAfterSeconds: status.retryAfterSeconds,
    });
  }
}

/** Anota un intento fallido (credenciales malas o cuenta bloqueada) contra esa IP. */
export function recordFailedAttempt(
  ip: string | undefined,
  reason: string,
  limiter: RateLimiter = loginLimiter(),
): void {
  limiter.recordFailure(ip ?? UNKNOWN_IP);
  logger.warn("auth.login_failed", { ip, reason });
}
