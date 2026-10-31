/**
 * Límite de intentos fallidos por clave (aquí, la dirección IP). Complementa el bloqueo por usuario de
 * `modules/auth/service.ts`: ese frena a quien insiste con un usuario; este frena a quien prueba muchos usuarios
 * (rociado de contraseñas) desde el mismo lugar.
 *
 * Vive en memoria del proceso: sirve para una sola instancia de la app (el despliegue previsto) y se reinicia con ella.
 * Solo cuentan los intentos **fallidos**: en una tienda todos los cajeros salen por la misma IP pública, y los aciertos
 * de unos no deben pesar contra los demás.
 */

export type RateLimitOptions = {
  /** Fallos permitidos dentro de la ventana; el siguiente intento ya se bloquea. */
  max: number;
  windowMs: number;
};

export type RateLimitStatus = { blocked: false } | { blocked: true; retryAfterSeconds: number };

export type RateLimiter = {
  /** Dice si la clave está bloqueada ahora, sin contar un intento. */
  check(key: string): RateLimitStatus;
  /** Anota un intento fallido. */
  recordFailure(key: string): void;
  reset(key: string): void;
};

/** Con tantas claves distintas se barren las vencidas, para que un atacante no pueda llenar la memoria. */
const SWEEP_THRESHOLD = 5_000;

export function createRateLimiter(
  { max, windowMs }: RateLimitOptions,
  now: () => number = Date.now,
): RateLimiter {
  const failures = new Map<string, number[]>();

  const recent = (key: string, at: number): number[] => {
    const kept = (failures.get(key) ?? []).filter((time) => at - time < windowMs);
    if (kept.length === 0) {
      failures.delete(key);
    } else {
      failures.set(key, kept);
    }
    return kept;
  };

  const sweep = (at: number): void => {
    for (const key of [...failures.keys()]) {
      recent(key, at);
    }
  };

  return {
    check(key) {
      const at = now();
      const kept = recent(key, at);
      if (kept.length < max) {
        return { blocked: false };
      }
      const oldest = kept[0] as number;
      return {
        blocked: true,
        retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - at) / 1000)),
      };
    },
    recordFailure(key) {
      const at = now();
      if (failures.size >= SWEEP_THRESHOLD) {
        sweep(at);
      }
      failures.set(key, [...recent(key, at), at]);
    },
    reset(key) {
      failures.delete(key);
    },
  };
}

const globalLimiters = globalThis as typeof globalThis & {
  __boutiqueRateLimiters?: Map<string, RateLimiter>;
};

/**
 * Un limitador por nombre, compartido por todo el proceso. Next puede empaquetar cada ruta por separado y duplicar los
 * módulos; guardarlo en `globalThis` evita que cada copia tenga sus propios contadores.
 */
export function sharedRateLimiter(name: string, options: RateLimitOptions): RateLimiter {
  const registry = (globalLimiters.__boutiqueRateLimiters ??= new Map());
  let limiter = registry.get(name);
  if (!limiter) {
    limiter = createRateLimiter(options);
    registry.set(name, limiter);
  }
  return limiter;
}

/** Inicio de sesión y cambio de cajero por PIN: 20 fallos por IP cada 15 minutos. */
export const LOGIN_RATE_LIMIT: RateLimitOptions = { max: 20, windowMs: 15 * 60_000 };

export function loginLimiter(): RateLimiter {
  return sharedRateLimiter("login", LOGIN_RATE_LIMIT);
}
