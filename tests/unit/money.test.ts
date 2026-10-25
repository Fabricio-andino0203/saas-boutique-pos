import { describe, expect, it } from "vitest";

import { ValidationError } from "@/lib/errors";
import {
  addCents,
  assertCents,
  extractTax,
  mulCents,
  percentOf,
  roundHalfAwayFromZero,
  subCents,
  sumCents,
} from "@/lib/money";

describe("assertCents", () => {
  it("accepts safe integers and rejects everything else", () => {
    expect(() => assertCents(0)).not.toThrow();
    expect(() => assertCents(-5, "monto")).not.toThrow();
    expect(() => assertCents(1.5)).toThrow(ValidationError);
    expect(() => assertCents(Number.NaN, "monto")).toThrow(/monto/);
    expect(() => assertCents(Number.POSITIVE_INFINITY)).toThrow(ValidationError);
    expect(() => assertCents("5")).toThrow(ValidationError);
    expect(() => assertCents(Number.MAX_SAFE_INTEGER + 1)).toThrow(ValidationError);
  });
});

describe("addCents / subCents / mulCents / sumCents", () => {
  it("computes exact integer results", () => {
    expect(addCents(1999, 1)).toBe(2000);
    expect(subCents(129000, 6400)).toBe(122600);
    expect(mulCents(65000, 1)).toBe(65000);
    expect(mulCents(32000, 2)).toBe(64000);
    expect(sumCents([])).toBe(0);
    expect(sumCents([65000, 64000])).toBe(129000);
  });

  it("rejects decimals, NaN, infinities and results out of range", () => {
    expect(() => addCents(0.5, 1)).toThrow(ValidationError);
    expect(() => addCents(1, 0.5)).toThrow(ValidationError);
    expect(() => addCents(Number.MAX_SAFE_INTEGER, 1)).toThrow(ValidationError);
    expect(() => subCents(0.5, 1)).toThrow(ValidationError);
    expect(() => subCents(1, 0.5)).toThrow(ValidationError);
    expect(() => subCents(-Number.MAX_SAFE_INTEGER, 2)).toThrow(ValidationError);
    expect(() => mulCents(Number.MAX_SAFE_INTEGER, 2)).toThrow(ValidationError);
    expect(() => mulCents(0.5, 2)).toThrow(ValidationError);
    expect(() => mulCents(100, 1.5)).toThrow(ValidationError);
    expect(() => sumCents([1, Number.POSITIVE_INFINITY])).toThrow(ValidationError);
  });
});

describe("roundHalfAwayFromZero", () => {
  it("rounds halves away from zero and never returns negative zero", () => {
    expect(roundHalfAwayFromZero(1, 2)).toBe(1);
    expect(roundHalfAwayFromZero(-1, 2)).toBe(-1);
    expect(roundHalfAwayFromZero(7, 2)).toBe(4);
    expect(roundHalfAwayFromZero(-7, 2)).toBe(-4);
    expect(roundHalfAwayFromZero(1, 3)).toBe(0);
    expect(roundHalfAwayFromZero(2, 3)).toBe(1);
    expect(Object.is(roundHalfAwayFromZero(-1, 10000), 0)).toBe(true);
  });

  it("rejects a non-positive denominator and non-integer inputs", () => {
    expect(() => roundHalfAwayFromZero(1, 0)).toThrow(ValidationError);
    expect(() => roundHalfAwayFromZero(1, -2)).toThrow(ValidationError);
    expect(() => roundHalfAwayFromZero(1.5, 2)).toThrow(ValidationError);
    expect(() => roundHalfAwayFromZero(1, 2.5)).toThrow(ValidationError);
  });
});

describe("percentOf", () => {
  it("computes basis-point percentages", () => {
    expect(percentOf(10000, 1000)).toBe(1000);
    expect(percentOf(1999, 1000)).toBe(200);
    expect(percentOf(64000, 1000)).toBe(6400);
  });

  it("rounds halves away from zero, not to even", () => {
    expect(percentOf(5, 1000)).toBe(1);
    expect(percentOf(15, 1000)).toBe(2);
    expect(percentOf(25, 1000)).toBe(3);
    expect(percentOf(-25, 1000)).toBe(-3);
  });

  it("rejects invalid inputs", () => {
    expect(() => percentOf(Number.NaN, 1000)).toThrow(ValidationError);
    expect(() => percentOf(100, 0.5)).toThrow(ValidationError);
    expect(() => percentOf(Number.MAX_SAFE_INTEGER, 1000)).toThrow(ValidationError);
  });
});

describe("extractTax", () => {
  it("extracts 15 % included tax with the documented rounding", () => {
    // 122600 × 10000 ÷ 11500 = 106608,69… → 106609; impuesto = 122600 − 106609 = 15991
    expect(extractTax(122600, 1500)).toEqual({ netCents: 106609, taxCents: 15991 });
    // 11500 ÷ 1,15 = 10000 exacto; impuesto = 1500
    expect(extractTax(11500, 1500)).toEqual({ netCents: 10000, taxCents: 1500 });
    // 100 ÷ 1,15 = 86,95… → 87; impuesto = 100 − 87 = 13
    expect(extractTax(100, 1500)).toEqual({ netCents: 87, taxCents: 13 });
    expect(extractTax(0, 1500)).toEqual({ netCents: 0, taxCents: 0 });
  });

  it("mirrors negative totals", () => {
    expect(extractTax(-122600, 1500)).toEqual({ netCents: -106609, taxCents: -15991 });
  });

  it("returns no tax when the rate is zero", () => {
    expect(extractTax(5000, 0)).toEqual({ netCents: 5000, taxCents: 0 });
  });

  it("rejects a negative or non-integer rate", () => {
    expect(() => extractTax(100, -1)).toThrow(ValidationError);
    expect(() => extractTax(100, 0.5)).toThrow(ValidationError);
    expect(() => extractTax(0.5, 1500)).toThrow(ValidationError);
  });
});

describe("docs/UX.md sample ticket", () => {
  it("reproduces the total and the included tax", () => {
    const subtotal = addCents(mulCents(65000, 1), mulCents(32000, 2));
    expect(subtotal).toBe(129000);
    const lineDiscount = percentOf(64000, 1000);
    expect(lineDiscount).toBe(6400);
    const total = subCents(subtotal, lineDiscount);
    expect(total).toBe(122600);
    expect(extractTax(total, 1500).taxCents).toBe(15991);
  });
});
