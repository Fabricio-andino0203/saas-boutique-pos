import {
  addLocalDays,
  endOfLocalDay,
  localDateKey,
  parseLocalDateKey,
  startOfLocalDay,
} from "@/lib/dates";

/** Los atajos de fechas de los reportes ("Hoy / Ayer / Esta semana / Este mes", UX §7). */
export const RANGE_PRESETS = ["today", "yesterday", "week", "month", "last30", "year"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

/** Un periodo de reporte: del inicio del primer día al final del último, en hora de Honduras. */
export type ReportRange = {
  from: Date;
  to: Date;
  /** Las mismas fechas como `YYYY-MM-DD` (lo que lleva el formulario y la dirección). */
  fromKey: string;
  toKey: string;
  /** El atajo, si el periodo es uno de ellos. */
  preset: RangePreset | null;
};

function rangeBetween(first: Date, last: Date, preset: RangePreset | null): ReportRange {
  return {
    from: startOfLocalDay(first),
    to: endOfLocalDay(last),
    fromKey: localDateKey(first),
    toKey: localDateKey(last),
    preset,
  };
}

/** El primer día (lunes) de la semana local que contiene a `date`. */
function startOfWeek(date: Date): Date {
  const noon = new Date(startOfLocalDay(date).getTime() + 12 * 3_600_000);
  const sinceMonday = (noon.getUTCDay() + 6) % 7;
  return addLocalDays(startOfLocalDay(date), -sinceMonday);
}

export function rangeForPreset(preset: RangePreset, now: Date = new Date()): ReportRange {
  const today = startOfLocalDay(now);
  switch (preset) {
    case "today":
      return rangeBetween(today, today, preset);
    case "yesterday": {
      const yesterday = addLocalDays(today, -1);
      return rangeBetween(yesterday, yesterday, preset);
    }
    case "week":
      return rangeBetween(startOfWeek(today), today, preset);
    case "month": {
      const key = localDateKey(today);
      const first = parseLocalDateKey(`${key.slice(0, 8)}01`) ?? today;
      return rangeBetween(first, today, preset);
    }
    case "last30":
      return rangeBetween(addLocalDays(today, -29), today, preset);
    case "year": {
      const key = localDateKey(today);
      const first = parseLocalDateKey(`${key.slice(0, 4)}-01-01`) ?? today;
      return rangeBetween(first, today, preset);
    }
  }
}

/** El periodo más largo que se acepta: evita pedir años de datos por un error de dedo. */
export const MAX_RANGE_DAYS = 732;

/**
 * El periodo que pide la dirección: `rango=` con un atajo, o `desde=` y `hasta=` (fechas locales). Si falta o es inválido
 * se usa `fallback` (por defecto, este mes). Nunca devuelve un periodo al revés ni de más de dos años.
 */
export function parseRange(
  params: { rango?: string; desde?: string; hasta?: string },
  now: Date = new Date(),
  fallback: RangePreset = "month",
): ReportRange {
  const preset = (RANGE_PRESETS as readonly string[]).includes(params.rango ?? "")
    ? (params.rango as RangePreset)
    : null;
  if (preset) {
    return rangeForPreset(preset, now);
  }
  const from = params.desde ? parseLocalDateKey(params.desde) : null;
  const to = params.hasta ? parseLocalDateKey(params.hasta) : null;
  if (!from || !to) {
    return rangeForPreset(fallback, now);
  }
  const [first, last] = from.getTime() <= to.getTime() ? [from, to] : [to, from];
  const days =
    Math.round((startOfLocalDay(last).getTime() - startOfLocalDay(first).getTime()) / 86_400_000) +
    1;
  if (days > MAX_RANGE_DAYS) {
    return rangeForPreset(fallback, now);
  }
  return rangeBetween(first, last, null);
}

/** Cuántos días de calendario tiene el periodo. */
export function daysInRange(range: Pick<ReportRange, "from" | "to">): number {
  return (
    Math.round(
      (startOfLocalDay(range.to).getTime() - startOfLocalDay(range.from).getTime()) / 86_400_000,
    ) + 1
  );
}
