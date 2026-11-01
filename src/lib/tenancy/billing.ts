import type { PlanFeature, PlanLimits } from "@/config/plan-catalog";

/**
 * Cuándo puede usar el sistema un negocio según su suscripción (propuesta SaaS §5). Lógica **pura**: nada de base de datos,
 * para poder probar cada frontera de fechas y para que el directorio, el proxy, el barrido diario y el panel decidan igual.
 *
 *   hasta el vencimiento ............ TRIAL / ACTIVE   → todo funciona
 *   hasta `graceDays` después ....... PAST_DUE         → todo funciona, con aviso («gracia»)
 *   hasta `readOnlyDays` después .... SUSPENDED        → solo lectura y exportación: no se registra nada nuevo
 *   después ......................... CANCELLED        → no se atiende
 *
 * El estado se **calcula** con la hora actual en cada consulta; el barrido diario solo lo deja anotado y avisa. Así un día sin
 * barrido nunca deja a un negocio con acceso de más ni de menos.
 */

/** Valores por omisión de la plataforma (se pueden cambiar por suscripción). */
export const BILLING_POLICY = {
  /** Días con todo funcionando después del vencimiento. */
  graceDays: 7,
  /** Días en solo lectura antes de cancelar. */
  readOnlyDays: 60,
  /** Días de prueba de un negocio nuevo. */
  trialDays: 14,
} as const;

export const BILLING_INTERVALS = ["MONTHLY", "QUARTERLY", "SEMIANNUAL", "ANNUAL"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export const INTERVAL_MONTHS: Record<BillingInterval, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  SEMIANNUAL: 6,
  ANNUAL: 12,
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Suma meses de calendario (UTC) sin pasarse de fin de mes: 31 de enero + 1 mes = 28 (o 29) de febrero. */
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

export const addDays = (date: Date, days: number): Date => new Date(date.getTime() + days * DAY_MS);

/** Estados de una suscripción. `EXPIRED` es solo de las filas viejas (reemplazadas por otra): nunca de la vigente. */
export type SubscriptionStatus =
  "TRIAL" | "ACTIVE" | "PAST_DUE" | "SUSPENDED" | "CANCELLED" | "EXPIRED";

/** Qué puede hacer el negocio ahora. */
export type AccessMode = "full" | "grace" | "readonly" | "blocked";

export type SubscriptionTiming = {
  /** Una prueba gratuita (aún sin ningún pago). */
  isTrial: boolean;
  currentPeriodEnd: Date;
  graceDays: number;
  readOnlyDays: number;
};

export type BillingPosition = {
  status: Exclude<SubscriptionStatus, "EXPIRED">;
  mode: AccessMode;
  periodEnd: Date;
  graceEndsAt: Date;
  readOnlyEndsAt: Date;
  /** Días enteros hasta el vencimiento (negativo si ya venció). */
  daysToPeriodEnd: number;
};

export function computeBillingPosition(sub: SubscriptionTiming, now: Date): BillingPosition {
  const periodEnd = sub.currentPeriodEnd;
  const graceEndsAt = addDays(periodEnd, sub.graceDays);
  const readOnlyEndsAt = addDays(graceEndsAt, sub.readOnlyDays);
  const daysToPeriodEnd = Math.floor((periodEnd.getTime() - now.getTime()) / DAY_MS);
  const base = { periodEnd, graceEndsAt, readOnlyEndsAt, daysToPeriodEnd };
  if (now <= periodEnd) {
    return { ...base, status: sub.isTrial ? "TRIAL" : "ACTIVE", mode: "full" };
  }
  if (now <= graceEndsAt) {
    return { ...base, status: "PAST_DUE", mode: "grace" };
  }
  if (now <= readOnlyEndsAt) {
    return { ...base, status: "SUSPENDED", mode: "readonly" };
  }
  return { ...base, status: "CANCELLED", mode: "blocked" };
}

/**
 * Lo que el negocio ve de su plan: pequeño y serializable (viaja en la entrada del directorio de hosts y se guarda unos
 * segundos en memoria). Un negocio **sin suscripción** no tiene esto: no se le restringe nada (ver `entitlements.ts`).
 */
export type TenantEntitlements = {
  planName: string;
  features: PlanFeature[];
  limits: PlanLimits;
  mode: AccessMode;
  status: BillingPosition["status"];
  /** ISO 8601. */
  periodEnd: string;
  graceEndsAt: string;
  readOnlyEndsAt: string;
  daysToPeriodEnd: number;
};

export type SubscriptionForAccess = SubscriptionTiming & {
  planName: string;
  features: readonly string[];
  limits: unknown;
};

const KNOWN_LIMITS = ["users", "products", "terminals", "locations"] as const;

/** Los límites guardados (JSON libre) con solo lo que se entiende: enteros no negativos o `null`. */
export function parseLimits(raw: unknown): PlanLimits {
  const result: PlanLimits = {};
  if (typeof raw !== "object" || raw === null) {
    return result;
  }
  for (const key of KNOWN_LIMITS) {
    const value = (raw as Record<string, unknown>)[key];
    if (value === null) {
      result[key] = null;
    } else if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
      result[key] = value;
    }
  }
  return result;
}

export function toEntitlements(
  sub: SubscriptionForAccess,
  now: Date,
  knownFeatures: readonly string[],
): TenantEntitlements {
  const position = computeBillingPosition(sub, now);
  return {
    planName: sub.planName,
    features: sub.features.filter((feature) => knownFeatures.includes(feature)) as PlanFeature[],
    limits: parseLimits(sub.limits),
    mode: position.mode,
    status: position.status,
    periodEnd: position.periodEnd.toISOString(),
    graceEndsAt: position.graceEndsAt.toISOString(),
    readOnlyEndsAt: position.readOnlyEndsAt.toISOString(),
    daysToPeriodEnd: position.daysToPeriodEnd,
  };
}

/** ¿Incluye el plan este módulo? Sin plan (`undefined`) todo está incluido. */
export function includesFeature(
  entitlements: TenantEntitlements | undefined,
  feature: PlanFeature,
): boolean {
  return entitlements === undefined || entitlements.features.includes(feature);
}

/** El límite de algo, o `null` si no hay (sin plan o sin tope). */
export function limitOf(
  entitlements: TenantEntitlements | undefined,
  kind: keyof PlanLimits,
): number | null {
  return entitlements?.limits[kind] ?? null;
}
