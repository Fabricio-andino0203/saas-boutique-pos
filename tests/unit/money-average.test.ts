import { describe, expect, it } from "vitest";

import { ValidationError } from "@/lib/errors";
import { weightedAverageCents } from "@/lib/money";

describe("weightedAverageCents", () => {
  it("weights the current stock and the new entry by their quantities", () => {
    // 10 × 1000 + 5 × 1300 = 16 500; 16 500 ÷ 15 = 1100
    expect(weightedAverageCents(10, 1000, 5, 1300)).toBe(1100);
    // 100 × 4000 + 100 × 5000 = 900 000; ÷ 200 = 4500
    expect(weightedAverageCents(100, 4000, 100, 5000)).toBe(4500);
    // Mismo costo: el promedio no cambia. 7 × 2500 + 3 × 2500 = 25 000; ÷ 10 = 2500
    expect(weightedAverageCents(7, 2500, 3, 2500)).toBe(2500);
  });

  it("rounds half away from zero, once", () => {
    // 3 × 100 + 1 × 101 = 401; 401 ÷ 4 = 100.25 → 100
    expect(weightedAverageCents(3, 100, 1, 101)).toBe(100);
    // 1 × 100 + 1 × 101 = 201; 201 ÷ 2 = 100.5 → 101 (mitad hacia afuera del cero)
    expect(weightedAverageCents(1, 100, 1, 101)).toBe(101);
    // 1 × 100 + 2 × 101 = 302; 302 ÷ 3 = 100.67 → 101
    expect(weightedAverageCents(1, 100, 2, 101)).toBe(101);
  });

  it("takes the cost of the entry when there was no stock", () => {
    expect(weightedAverageCents(0, 1000, 5, 1300)).toBe(1300);
    expect(weightedAverageCents(-2, 1000, 5, 1300)).toBe(1300); // existencia negativa: se parte de cero
  });

  it("accepts a free entry (cost zero)", () => {
    // 10 × 1000 + 10 × 0 = 10 000; ÷ 20 = 500
    expect(weightedAverageCents(10, 1000, 10, 0)).toBe(500);
  });

  it("rejects an entry that is not positive, negative costs and unsafe numbers", () => {
    expect(() => weightedAverageCents(10, 1000, 0, 1300)).toThrow(ValidationError);
    expect(() => weightedAverageCents(10, 1000, -1, 1300)).toThrow(ValidationError);
    expect(() => weightedAverageCents(10, -1, 5, 1300)).toThrow(ValidationError);
    expect(() => weightedAverageCents(10, 1000, 5, -1)).toThrow(ValidationError);
    expect(() => weightedAverageCents(1.5, 1000, 5, 1300)).toThrow(ValidationError);
    expect(() => weightedAverageCents(10, 10.5, 5, 1300)).toThrow(ValidationError);
    expect(() => weightedAverageCents(10, 1000, 2.5, 1300)).toThrow(ValidationError);
    expect(() => weightedAverageCents(10, 1000, 5, Number.NaN)).toThrow(ValidationError);
  });
});
