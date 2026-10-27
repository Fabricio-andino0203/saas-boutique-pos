import { endOfLocalDay } from "@/lib/dates";

/** Días antes del vencimiento en que se empieza a avisar. */
export const EXPIRY_WARNING_DAYS = 30;
/** Se avisa cuando quedan este número de facturas, o el 10 % del rango si es mayor. */
export const LOW_NUMBERS_FLOOR = 50;
export const LOW_NUMBERS_SHARE_BPS = 1000;

const DAY_MS = 86_400_000;

export type FiscalRangeLike = {
  rangeStart: number;
  rangeEnd: number;
  nextNumber: number;
  expiresAt: Date;
};

/**
 * - `ok`: se puede facturar sin problema.
 * - `expiring` / `low`: se puede facturar, pero hay que pedir un rango nuevo pronto.
 * - `expired` / `exhausted`: ya no se puede facturar con este rango (el servidor lo bloquea).
 */
export type FiscalRangeStatus = "ok" | "expiring" | "low" | "expired" | "exhausted";

export type FiscalRangeHealth = {
  status: FiscalRangeStatus;
  /** Días que faltan para la fecha límite (0 el último día; negativo si ya venció). */
  daysLeft: number;
  /** Facturas que todavía se pueden emitir. */
  remaining: number;
  /** Se puede emitir una factura ahora mismo. */
  usable: boolean;
};

/** Cuántas facturas quedan en el rango y cuántos días le quedan de vigencia, con el aviso que corresponde. */
export function fiscalRangeHealth(range: FiscalRangeLike, now: Date): FiscalRangeHealth {
  const remaining = Math.max(0, range.rangeEnd - range.nextNumber + 1);
  const size = range.rangeEnd - range.rangeStart + 1;
  // Vale hasta el final del día de su fecha límite (hora de Honduras).
  const lastMoment = endOfLocalDay(range.expiresAt);
  const daysLeft = Math.floor((lastMoment.getTime() - now.getTime()) / DAY_MS);

  const expired = now > lastMoment;
  const exhausted = remaining === 0;
  const lowThreshold = Math.max(
    LOW_NUMBERS_FLOOR,
    Math.ceil((size * LOW_NUMBERS_SHARE_BPS) / 10000),
  );

  let status: FiscalRangeStatus = "ok";
  if (exhausted) {
    status = "exhausted";
  } else if (expired) {
    status = "expired";
  } else if (daysLeft <= EXPIRY_WARNING_DAYS) {
    status = "expiring";
  } else if (remaining <= lowThreshold) {
    status = "low";
  }
  return { status, daysLeft, remaining, usable: !expired && !exhausted };
}
