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

/**
 * La clave del contador: la IP y, en modo multi-negocio, el negocio. Dos negocios que comparten salida a internet (un centro
 * comercial, un proveedor móvil) no deben bloquearse entre sí, ni quien insiste contra un negocio dejar fuera a otro.
 * Sin negocio (modo `single`) la clave es la IP, como siempre.
 */
export function throttleKey(ip: string | undefined, tenant?: string): string {
  const address = ip ?? UNKNOWN_IP;
  return tenant ? `${tenant}|${address}` : address;
}

/**
 * Lanza `TooManyAttemptsError` si esa IP ya agotó sus intentos fallidos (en ese negocio). Llamar ANTES de revisar credenciales.
 * `tenant` es `await currentTenantLabel()` de quien llama.
 */
export function assertNotThrottled(
  ip: string | undefined,
  limiter: RateLimiter = loginLimiter(),
  tenant?: string,
): void {
  const status = limiter.check(throttleKey(ip, tenant));
  if (status.blocked) {
    logger.warn("auth.rate_limited", { tenant, ip, retryAfterSeconds: status.retryAfterSeconds });
    throw new TooManyAttemptsError("Too many failed attempts", {
      retryAfterSeconds: status.retryAfterSeconds,
    });
  }
}

/** Anota un intento fallido (credenciales malas o cuenta bloqueada) contra esa IP (en ese negocio). */
export function recordFailedAttempt(
  ip: string | undefined,
  reason: string,
  limiter: RateLimiter = loginLimiter(),
  tenant?: string,
): void {
  limiter.recordFailure(throttleKey(ip, tenant));
  logger.warn("auth.login_failed", { tenant, ip, reason });
}
