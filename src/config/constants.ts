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

export const PRODUCT_LIMITS = {
  /** Máximo de variantes que el asistente genera de una vez (tallas × colores). */
  maxVariantsPerBatch: 200,
  pageSize: 25,
  /** Máximo de coincidencias que devuelve la búsqueda antes de filtrar y paginar. */
  maxSearchMatches: 300,
  maxBulkProducts: 200,
} as const;

/** Tope de un monto en centavos: las columnas de precio y costo son enteros de 32 bits (≈ L 21 millones). */
export const MAX_CENTS = 2_000_000_000;
