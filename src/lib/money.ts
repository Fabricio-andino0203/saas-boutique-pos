import { ValidationError } from "@/lib/errors";

/**
 * Única puerta de cálculo de dinero (CLAUDE.md §6.1). Todo valor es un entero de centavos.
 *
 * Política de redondeo (una sola vez por valor calculado): mitad hacia afuera del cero.
 */
export type Cents = number;

export function assertCents(value: unknown, label = "value"): asserts value is Cents {
  if (!Number.isSafeInteger(value)) {
    throw new ValidationError(`${label} must be a safe integer`);
  }
}

function checked(value: number, label: string): Cents {
  assertCents(value, label);
  return value;
}

export function addCents(a: Cents, b: Cents): Cents {
  assertCents(a, "a");
  assertCents(b, "b");
  return checked(a + b, "sum");
}

export function subCents(a: Cents, b: Cents): Cents {
  assertCents(a, "a");
  assertCents(b, "b");
  return checked(a - b, "difference");
}

export function mulCents(unitCents: Cents, quantity: number): Cents {
  assertCents(unitCents, "unitCents");
  assertCents(quantity, "quantity");
  return checked(unitCents * quantity, "product");
}

export function sumCents(values: readonly Cents[]): Cents {
  return values.reduce<Cents>((total, value) => addCents(total, value), 0);
}

/** Cociente entero redondeado a la mitad hacia afuera del cero; aritmética entera exacta. */
export function roundHalfAwayFromZero(numerator: number, denominator: number): number {
  assertCents(numerator, "numerator");
  assertCents(denominator, "denominator");
  if (denominator <= 0) {
    throw new ValidationError("denominator must be positive");
  }
  const absolute = Math.abs(numerator);
  const remainder = absolute % denominator;
  const quotient = (absolute - remainder) / denominator;
  const rounded = 2 * remainder >= denominator ? quotient + 1 : quotient;
  return numerator < 0 && rounded !== 0 ? -rounded : rounded;
}

/** Porcentaje en puntos base: 1000 = 10 %. */
export function percentOf(cents: Cents, bps: number): Cents {
  assertCents(cents, "cents");
  assertCents(bps, "bps");
  return roundHalfAwayFromZero(cents * bps, 10000);
}

/** Extrae el impuesto de un total con impuesto incluido (15 % = 1500 puntos base). */
export function extractTax(
  totalCents: Cents,
  rateBps: number,
): { netCents: Cents; taxCents: Cents } {
  assertCents(totalCents, "totalCents");
  assertCents(rateBps, "rateBps");
  if (rateBps < 0) {
    throw new ValidationError("rateBps must not be negative");
  }
  const netCents = roundHalfAwayFromZero(totalCents * 10000, 10000 + rateBps);
  return { netCents, taxCents: subCents(totalCents, netCents) };
}
