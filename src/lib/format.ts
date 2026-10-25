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
