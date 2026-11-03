import { localDateKey, parseLocalDateKey } from "@/lib/dates";

/**
 * Meses de los costos fijos. Un mes es el texto `2026-11` (año y mes locales). Todo es calendario local de Honduras: el mes de
 * un instante es el de su fecha en `America/Tegucigalpa`, no el del reloj del servidor.
 */

export const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Cuántos meses hacia atrás se muestran como «por pagar»: lo más viejo se da por resuelto antes de usar el sistema. */
export const PENDING_LOOKBACK_MONTHS = 6;

export function isPeriod(value: string): boolean {
  return PERIOD_PATTERN.test(value);
}

/** El mes (`2026-11`) en el que cae un instante, en hora de Honduras. */
export function periodOf(date: Date): string {
  return localDateKey(date).slice(0, 7);
}

/** El mediodía del primer día del mes: cómo se guarda un mes en la base (un instante dentro de ese día). */
export function periodStart(period: string): Date {
  const date = parseLocalDateKey(`${period}-01`);
  if (!date) {
    throw new Error(`Mes inválido: ${period}`);
  }
  return date;
}

export function nextPeriod(period: string): string {
  const [year, month] = period.split("-").map(Number) as [number, number];
  return month === 12 ? `${year + 1}-01` : `${String(year)}-${String(month + 1).padStart(2, "0")}`;
}

export function previousPeriod(period: string): string {
  const [year, month] = period.split("-").map(Number) as [number, number];
  return month === 1 ? `${year - 1}-12` : `${String(year)}-${String(month - 1).padStart(2, "0")}`;
}

/** Los meses de `from` a `to`, los dos incluidos, del más viejo al más nuevo (vacío si `from` es posterior a `to`). */
export function periodsBetween(from: string, to: string): string[] {
  const months: string[] = [];
  for (let month = from; month <= to; month = nextPeriod(month)) {
    months.push(month);
  }
  return months;
}

const periodLabel = new Intl.DateTimeFormat("es-HN", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** El mes en palabras: `noviembre de 2026`. */
export function formatPeriod(period: string): string {
  const [year, month] = period.split("-").map(Number) as [number, number];
  return periodLabel.format(new Date(Date.UTC(year, month - 1, 1)));
}

/** La fecha límite de pago de un mes, `2026-11-05`. */
export function dueDateKey(period: string, dueDay: number): string {
  return `${period}-${String(dueDay).padStart(2, "0")}`;
}

/**
 * Los meses que faltan por pagar de un costo fijo: desde el mayor entre su inicio y los últimos
 * {@link PENDING_LOOKBACK_MONTHS} meses, hasta el mes actual (o el último, si ya terminó), sin los que ya tienen un pago vigente.
 */
export function pendingPeriods(input: {
  startsOn: string;
  endsOn: string | null;
  paid: ReadonlySet<string>;
  current: string;
}): string[] {
  let from = input.startsOn;
  let floor = input.current;
  for (let step = 0; step < PENDING_LOOKBACK_MONTHS; step += 1) {
    floor = previousPeriod(floor);
  }
  if (floor > from) {
    from = floor;
  }
  const to = input.endsOn && input.endsOn < input.current ? input.endsOn : input.current;
  return periodsBetween(from, to).filter((period) => !input.paid.has(period));
}
