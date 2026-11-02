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

/**
 * Acceso al panel de la plataforma (superadministradores). Más estricto que el de una tienda: contraseña larga, 2FA
 * obligatorio, sesión corta con cierre por inactividad y una ventana breve entre la contraseña y el código.
 */
export const PLATFORM_AUTH_LIMITS = {
  maxFailedAttempts: 5,
  lockMinutes: 15,
  /** Tiempo para escribir el código después de la contraseña. */
  pendingMinutes: 10,
  sessionHours: 8,
  idleMinutes: 30,
  touchSeconds: 60,
  minPasswordLength: 12,
  maxPasswordLength: 128,
} as const;

export const PHOTO_LIMITS = {
  /** Fotos por producto (el mensaje `PHOTO_LIMIT` de `messages.es.ts` dice este número). */
  maxPerProduct: 6,
  /** Fotos que el módulo masivo sube a la vez; el resto espera su turno. */
  uploadConcurrency: 3,
  /** Lo más que pesa una foto que llega al servidor (el mensaje `IMAGE_TOO_LARGE` dice este número). */
  maxBytes: 8 * 1024 * 1024,
  /** Una foto más pesada que esto se reduce en el navegador antes de subirla (ahorra datos del celular). */
  shrinkAboveBytes: 1.5 * 1024 * 1024,
  /** Lado mayor, en píxeles, al que se reduce en el navegador. */
  shrinkEdge: 2000,
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
