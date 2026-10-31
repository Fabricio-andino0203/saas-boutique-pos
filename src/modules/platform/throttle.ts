import { env } from "@/lib/env";
import { TooManyAttemptsError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { sharedRateLimiter, type RateLimiter } from "@/lib/rate-limit";

const WINDOW_MS = 15 * 60_000;
const UNKNOWN_IP = "unknown";

/** Limitador del panel de la plataforma: aparte del de las tiendas (otro nombre) y más estricto (10 fallos por IP / 15 min). */
export function platformLoginLimiter(): RateLimiter {
  return sharedRateLimiter("platform-login", {
    max: env.PLATFORM_LOGIN_RATE_LIMIT_MAX,
    windowMs: WINDOW_MS,
  });
}

/** Lanza `TooManyAttemptsError` si esa IP ya agotó sus intentos fallidos. Llamar ANTES de revisar credenciales o códigos. */
export function assertPlatformNotThrottled(
  ip: string | undefined,
  limiter: RateLimiter = platformLoginLimiter(),
): void {
  const status = limiter.check(ip ?? UNKNOWN_IP);
  if (status.blocked) {
    logger.warn("platform.rate_limited", { ip, retryAfterSeconds: status.retryAfterSeconds });
    throw new TooManyAttemptsError("Too many failed attempts", {
      retryAfterSeconds: status.retryAfterSeconds,
    });
  }
}

export function recordPlatformFailedAttempt(
  ip: string | undefined,
  reason: string,
  limiter: RateLimiter = platformLoginLimiter(),
): void {
  limiter.recordFailure(ip ?? UNKNOWN_IP);
  logger.warn("platform.login_failed", { ip, reason });
}
