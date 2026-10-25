import { ValidationError } from "@/lib/errors";

export const APP_TIME_ZONE = "America/Tegucigalpa";

const DAY_MS = 86_400_000;

const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function assertValidDate(date: Date): void {
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError("Invalid date");
  }
}

function zonedParts(date: Date): ZonedParts {
  const parts = formatter.formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    if (!part) {
      throw new Error(`Missing date part: ${type}`);
    }
    return Number(part.value);
  };
  const hour = read("hour");
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    // Algunos motores devuelven 24 a medianoche: se normaliza a 0.
    hour: hour === 24 ? 0 : hour,
    minute: read("minute"),
    second: read("second"),
  };
}

function offsetMs(date: Date): number {
  const p = zonedParts(date);
  const truncated = Math.floor(date.getTime() / 1000) * 1000;
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - truncated;
}

const pad2 = (value: number): string => String(value).padStart(2, "0");

export function localDateKey(date: Date): string {
  assertValidDate(date);
  const p = zonedParts(date);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

export function startOfLocalDay(date: Date): Date {
  assertValidDate(date);
  const p = zonedParts(date);
  return new Date(Date.UTC(p.year, p.month - 1, p.day) - offsetMs(date));
}

export function addLocalDays(date: Date, days: number): Date {
  assertValidDate(date);
  if (!Number.isInteger(days)) {
    throw new ValidationError("days must be an integer");
  }
  const shifted = new Date(date.getTime() + days * DAY_MS);
  return new Date(shifted.getTime() + offsetMs(date) - offsetMs(shifted));
}

export function endOfLocalDay(date: Date): Date {
  assertValidDate(date);
  return new Date(startOfLocalDay(addLocalDays(date, 1)).getTime() - 1);
}

export function formatLocalDateTime(date: Date): string {
  assertValidDate(date);
  const p = zonedParts(date);
  return `${pad2(p.day)}/${pad2(p.month)}/${p.year} ${pad2(p.hour)}:${pad2(p.minute)}`;
}
