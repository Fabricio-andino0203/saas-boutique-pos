import { assertCents, type Cents } from "@/lib/money";

/**
 * Capa de presentación del dinero (CLAUDE.md §6.1): aquí solo se lee y se escribe texto;
 * todo cálculo vive en `src/lib/money.ts`. Aritmética entera pura, sin `Intl` para números.
 */
const MONEY_PATTERN = /^(?:L\s*)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/i;

const pad2 = (value: number): string => String(value).padStart(2, "0");

function splitCents(cents: Cents): { negative: boolean; whole: number; fraction: number } {
  assertCents(cents, "cents");
  const absolute = Math.abs(cents);
  const fraction = absolute % 100;
  return { negative: cents < 0, whole: (absolute - fraction) / 100, fraction };
}

/** Lee texto editable ("1,234.50", "L 1,234.5", "1234") y devuelve centavos, o `null` si no es válido. */
export function parseMoney(text: string): Cents | null {
  const match = MONEY_PATTERN.exec(text.trim());
  if (!match) {
    return null;
  }
  const [, wholeText = "", fractionText = ""] = match;
  const cents = Number(wholeText.replace(/,/g, "")) * 100 + Number(fractionText.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** `L 1,234.50`; negativos `−L 64.00` (U+2212). */
export function formatMoney(cents: Cents): string {
  const { negative, whole, fraction } = splitCents(cents);
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const text = `L ${grouped}.${pad2(fraction)}`;
  return negative ? `−${text}` : text;
}

/** Texto editable sin símbolo ni comas (`1234.50`); un negativo lleva `-` ASCII y no se relee. */
export function formatMoneyPlain(cents: Cents): string {
  const { negative, whole, fraction } = splitCents(cents);
  return `${negative ? "-" : ""}${whole}.${pad2(fraction)}`;
}

const PERCENT_PATTERN = /^([+\-−])?\s*(\d{1,3})(?:\.(\d{1,2}))?\s*%?$/;

/** Lee un porcentaje editable ("10", "-15.5 %", "+7") y lo devuelve en puntos base (1000 = 10 %). */
export function parsePercentBps(text: string): number | null {
  const match = PERCENT_PATTERN.exec(text.trim());
  if (!match) {
    return null;
  }
  const [, sign = "", wholeText = "", fractionText = ""] = match;
  const bps = Number(wholeText) * 100 + Number(fractionText.padEnd(2, "0"));
  return bps !== 0 && (sign === "-" || sign === "−") ? -bps : bps;
}

/** Puntos base a texto editable: 1500 → "15", 1550 → "15.5", 75 → "0.75". */
export function formatPercentBps(bps: number): string {
  assertCents(bps, "bps");
  const whole = Math.trunc(bps / 100);
  const fraction = Math.abs(bps % 100);
  if (fraction === 0) {
    return String(whole);
  }
  return `${bps < 0 && whole === 0 ? "-" : ""}${whole}.${pad2(fraction).replace(/0$/, "")}`;
}
