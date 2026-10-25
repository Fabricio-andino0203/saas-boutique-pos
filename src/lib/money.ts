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

/**
 * Reparte `totalCents` en partes enteras proporcionales a `weights` (método del mayor residuo).
 * El sobrante va de a 1 centavo a los mayores restos; en empate, al índice más bajo.
 * La suma de las partes es siempre igual al total.
 */
export function allocate(totalCents: Cents, weights: readonly number[]): Cents[] {
  assertCents(totalCents, "totalCents");
  if (totalCents < 0) {
    throw new ValidationError("totalCents must not be negative");
  }
  if (weights.length === 0) {
    throw new ValidationError("weights must not be empty");
  }
  weights.forEach((weight, index) => {
    assertCents(weight, `weights[${index}]`);
    if (weight < 0) {
      throw new ValidationError(`weights[${index}] must not be negative`);
    }
  });
  if (totalCents === 0) {
    return weights.map(() => 0);
  }

  // BigInt por llamada (no literales `1n`): tsconfig apunta a ES2017 y el producto puede desbordar.
  const zero = BigInt(0);
  const sum = weights.reduce((acc, weight) => acc + BigInt(weight), zero);
  if (sum === zero) {
    throw new ValidationError("weights must not sum to zero");
  }
  const total = BigInt(totalCents);
  const parts = weights.map((weight, index) => {
    const product = total * BigInt(weight);
    return { index, base: Number(product / sum), remainder: product % sum };
  });
  const leftover = totalCents - parts.reduce((acc, part) => acc + part.base, 0);
  const winners = new Set(
    [...parts]
      .sort((a, b) => {
        if (a.remainder === b.remainder) {
          return a.index - b.index;
        }
        return a.remainder > b.remainder ? -1 : 1;
      })
      .slice(0, leftover)
      .map((part) => part.index),
  );
  return parts.map((part) => (winners.has(part.index) ? part.base + 1 : part.base));
}

/** Reparte un descuento global entre las líneas sin perder centavos; ninguna parte supera su línea. */
export function prorateDiscount(lineTotals: readonly Cents[], discountCents: Cents): Cents[] {
  assertCents(discountCents, "discountCents");
  if (discountCents > sumCents(lineTotals)) {
    throw new ValidationError("discountCents must not exceed the sum of the lines");
  }
  return allocate(discountCents, lineTotals);
}
