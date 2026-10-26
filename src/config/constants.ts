/**
 * Límites de acceso. Pasan a ser ajustes editables en el incremento de configuración (Fase 1);
 * mientras tanto viven aquí, en un solo lugar.
 */
export const AUTH_LIMITS = {
  maxFailedAttempts: 5,
  lockMinutes: 15,
  sessionHours: 12,
  idleMinutes: 60,
  touchSeconds: 60,
  minPasswordLength: 8,
  maxPasswordLength: 128,
} as const;
