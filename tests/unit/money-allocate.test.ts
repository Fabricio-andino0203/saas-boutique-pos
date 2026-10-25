import { describe, expect, it } from "vitest";

import { ValidationError } from "@/lib/errors";
import { allocate, prorateDiscount } from "@/lib/money";

import { mulberry32 } from "./helpers/prng";

const SEED = 20261023;
const CASES = 1000;

const randomInt = (rng: () => number, min: number, max: number): number =>
  min + Math.floor(rng() * (max - min + 1));

const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);

describe("allocate", () => {
  it("gives the leftover cent to the lowest index on ties", () => {
    // 100 ÷ 3: bases 33, 33, 33; restos iguales (1) → el centavo sobrante va al índice 0
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    // 1 ÷ 3: bases 0, 0, 0; restos iguales → índice 0
    expect(allocate(1, [1, 1, 1])).toEqual([1, 0, 0]);
  });

  it("gives the leftover cent to the largest remainder", () => {
    // 10 con pesos 1,2,3 (suma 6): bases 1,3,5; restos 4,2,0; sobrante 1 → índice 0
    expect(allocate(10, [1, 2, 3])).toEqual([2, 3, 5]);
    // 10 con pesos 3,1 (suma 4): bases 7,2; restos 2,2 → empate, índice 0 → [8, 2]
    expect(allocate(10, [3, 1])).toEqual([8, 2]);
    // 7 con pesos 1,1,2 (suma 4): bases 1,1,3; restos 3,3,2; sobrante 2 → índices 0 y 1
    expect(allocate(7, [1, 1, 2])).toEqual([2, 2, 3]);
    // 5 con pesos 2,3 (suma 5): bases 2,3, sin restos
    expect(allocate(5, [2, 3])).toEqual([2, 3]);
    // 10 con pesos 1,1,4 (suma 6): bases 1,1,6; restos 4,4,4; sobrante 2 → índices 0 y 1
    expect(allocate(10, [1, 1, 4])).toEqual([2, 2, 6]);
  });

  it("handles zero totals and zero weights", () => {
    expect(allocate(0, [5, 5])).toEqual([0, 0]);
    expect(allocate(5, [0, 0, 1])).toEqual([0, 0, 5]);
  });

  it("rejects invalid input", () => {
    expect(() => allocate(10, [0, 0])).toThrow(ValidationError);
    expect(() => allocate(-1, [1])).toThrow(ValidationError);
    expect(() => allocate(10, [])).toThrow(ValidationError);
    expect(() => allocate(10, [1, -1])).toThrow(ValidationError);
    expect(() => allocate(10, [1, 0.5])).toThrow(ValidationError);
    expect(() => allocate(1.5, [1])).toThrow(ValidationError);
  });

  it("never loses a cent (1000 seeded cases)", () => {
    const rng = mulberry32(SEED);
    for (let i = 0; i < CASES; i += 1) {
      const total = randomInt(rng, 0, 10_000_000);
      const weights = Array.from({ length: randomInt(rng, 1, 8) }, () =>
        randomInt(rng, 0, 1_000_000),
      );
      if (sum(weights) === 0) {
        weights[0] = 1;
      }
      const total_weight = sum(weights);
      const parts = allocate(total, weights);

      expect(sum(parts)).toBe(total);
      parts.forEach((part, index) => {
        const product = total * (weights[index] ?? 0);
        const floor = (product - (product % total_weight)) / total_weight;
        expect(part).toBeGreaterThanOrEqual(0);
        expect([floor, floor + 1]).toContain(part);
      });
    }
  });
});

describe("prorateDiscount", () => {
  it("splits a global discount between lines", () => {
    // 6400 entre 65000 y 64000 (suma 129000): bases 3224 y 3175; restos 104000 y 25000 → sobrante a la línea 0
    expect(prorateDiscount([65000, 64000], 6400)).toEqual([3225, 3175]);
  });

  it("returns zeros for a zero discount", () => {
    expect(prorateDiscount([100, 200], 0)).toEqual([0, 0]);
  });

  it("rejects a discount larger than the lines", () => {
    expect(() => prorateDiscount([100, 100], 201)).toThrow(ValidationError);
  });

  it("keeps every part within its line (1000 seeded cases)", () => {
    const rng = mulberry32(SEED);
    for (let i = 0; i < CASES; i += 1) {
      const lines = Array.from({ length: randomInt(rng, 1, 6) }, () =>
        randomInt(rng, 0, 1_000_000),
      );
      const linesSum = sum(lines);
      const discount = randomInt(rng, 0, linesSum);
      const parts = prorateDiscount(lines, discount);

      expect(sum(parts)).toBe(discount);
      parts.forEach((part, index) => {
        expect(part).toBeGreaterThanOrEqual(0);
        expect(part).toBeLessThanOrEqual(lines[index] ?? 0);
      });
    }
  });
});
