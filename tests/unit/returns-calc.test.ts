import { describe, expect, it } from "vitest";

import { ValidationError } from "@/lib/errors";
import { prorateDiscount } from "@/lib/money";
import { unitShares, valueOfUnits } from "@/modules/returns/calc";

describe("unitShares", () => {
  it("splits what was paid into one share per unit, extra cents to the first units", () => {
    // 100 entre 3 unidades: 33 cada una y sobra 1, que va a la primera → [34, 33, 33]
    expect(unitShares(100, 3)).toEqual([34, 33, 33]);
    // 25000 entre 3: 8333 cada una (24999) y sobra 1 → [8334, 8333, 8333]
    expect(unitShares(25000, 3)).toEqual([8334, 8333, 8333]);
    // 10001 entre 2: 5000 cada una (10000) y sobra 1 → [5001, 5000]
    expect(unitShares(10001, 2)).toEqual([5001, 5000]);
  });

  it("divides exactly when it can", () => {
    expect(unitShares(27000, 3)).toEqual([9000, 9000, 9000]);
    expect(unitShares(11500, 1)).toEqual([11500]);
  });

  it("never makes a share negative or loses a cent when there are more units than cents", () => {
    // 3 entre 5: base 0 y sobran 3 → [1, 1, 1, 0, 0]
    expect(unitShares(3, 5)).toEqual([1, 1, 1, 0, 0]);
    expect(unitShares(0, 4)).toEqual([0, 0, 0, 0]);
  });

  it("refuses a quantity that is not a positive whole number", () => {
    for (const quantity of [0, -1, 1.5, Number.NaN]) {
      expect(() => unitShares(100, quantity)).toThrow(ValidationError);
    }
  });
});

describe("valueOfUnits", () => {
  it("reimburses the share of the units being returned, in order", () => {
    // Línea de 100 con 3 unidades → [34, 33, 33]
    expect(valueOfUnits(100, 3, 0, 1)).toBe(34);
    expect(valueOfUnits(100, 3, 1, 1)).toBe(33);
    expect(valueOfUnits(100, 3, 2, 1)).toBe(33);
    expect(valueOfUnits(100, 3, 0, 2)).toBe(67); // 34 + 33
    expect(valueOfUnits(100, 3, 1, 2)).toBe(66); // 33 + 33
    expect(valueOfUnits(100, 3, 0, 3)).toBe(100);
  });

  it("gives back exactly what was paid, however the returns are grouped", () => {
    const cases: [total: number, quantity: number][] = [
      [100, 3],
      [3, 5],
      [10001, 2],
      [29999, 7],
      [99999, 4],
      [1, 9],
      [0, 3],
    ];
    for (const [total, quantity] of cases) {
      // Una por una
      const oneByOne = Array.from({ length: quantity }, (_, taken) =>
        valueOfUnits(total, quantity, taken, 1),
      );
      expect(oneByOne.reduce((sum, part) => sum + part, 0)).toBe(total);
      expect(oneByOne.every((part) => part >= 0)).toBe(true);
      // Primero una, luego el resto
      if (quantity > 1) {
        expect(
          valueOfUnits(total, quantity, 0, 1) + valueOfUnits(total, quantity, 1, quantity - 1),
        ).toBe(total);
      }
      // Todo de una vez
      expect(valueOfUnits(total, quantity, 0, quantity)).toBe(total);
    }
  });

  it("returns the exact amount paid for a garment that carried part of a global discount", () => {
    // Tres líneas de 10001 (suma 30003) con un descuento global de 100: cada una paga lo que le tocó.
    // 100 se reparte [34, 33, 33] → pagaron [9967, 9968, 9968] (suma 29903 = 30003 − 100)
    const paid = [10001, 10001, 10001].map(
      (net, index) => net - (prorateDiscount([10001, 10001, 10001], 100)[index] as number),
    );
    expect(paid).toEqual([9967, 9968, 9968]);
    // Devolver cada prenda (cantidad 1) reembolsa exactamente lo que pagó, no el precio de lista
    expect(paid.map((total) => valueOfUnits(total, 1, 0, 1))).toEqual([9967, 9968, 9968]);
  });

  it("splits the ISV of a line the same way, so the parts add up to the line's ISV", () => {
    // ISV de una línea de 3 unidades: 3000 → [1000, 1000, 1000]; ISV de 3001 → [1001, 1000, 1000]
    expect(unitShares(3001, 3)).toEqual([1001, 1000, 1000]);
    expect(valueOfUnits(3001, 3, 0, 2) + valueOfUnits(3001, 3, 2, 1)).toBe(3001);
  });

  it("refuses to return more than was sold, nothing, or nonsense", () => {
    expect(() => valueOfUnits(100, 3, 0, 4)).toThrow(ValidationError);
    expect(() => valueOfUnits(100, 3, 2, 2)).toThrow(ValidationError);
    expect(() => valueOfUnits(100, 3, 3, 1)).toThrow(ValidationError);
    expect(() => valueOfUnits(100, 3, 0, 0)).toThrow(ValidationError);
    expect(() => valueOfUnits(100, 3, -1, 1)).toThrow(ValidationError);
    expect(() => valueOfUnits(100, 3, 0, 1.5)).toThrow(ValidationError);
    expect(() => valueOfUnits(100, 3, 0.5, 1)).toThrow(ValidationError);
  });
});
