import { messages } from "@/config/messages.es";

const months = messages.reports.months;

/** `2026-10-27` → `27/10/2026`; `2026-10` → `Octubre 2026`; cualquier otra cosa se deja como llegó. */
export function formatPeriodKey(key: string): string {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (day) {
    return `${day[3]}/${day[2]}/${day[1]}`;
  }
  const month = /^(\d{4})-(\d{2})$/.exec(key);
  if (month) {
    const name = months[Number(month[2]) - 1];
    return name ? `${name.charAt(0).toUpperCase()}${name.slice(1)} ${month[1]}` : key;
  }
  return key;
}

/** La hora del día para una tabla: `9` → `09:00`. */
export function formatHour(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}
