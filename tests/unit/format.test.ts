import { describe, expect, it } from "vitest";

import { ValidationError } from "@/lib/errors";
import {
  formatMoney,
  formatMoneyPlain,
  formatPercentBps,
  parseMoney,
  parsePercentBps,
  pluralize,
} from "@/lib/format";

import { mulberry32 } from "./helpers/prng";

describe("parseMoney", () => {
  it("reads editable text into cents", () => {
    expect(parseMoney("1,234.50")).toBe(123450);
    expect(parseMoney("L 1,234.5")).toBe(123450); // .5 = 50 centavos
    expect(parseMoney("1234")).toBe(123400); // 1234 × 100
    expect(parseMoney("L1234.05")).toBe(123405); // .05 = 5 centavos
    expect(parseMoney("  l 10  ")).toBe(1000);
    expect(parseMoney("0")).toBe(0);
  });

  it("returns null for anything else", () => {
    for (const text of ["12.345", "abc", "", "-5", "1,23", "12.", "L", "1,2345", "1.2.3"]) {
      expect(parseMoney(text), text).toBeNull();
    }
  });

  it("returns null outside the safe range", () => {
    expect(parseMoney("9".repeat(30))).toBeNull();
  });
});

describe("formatMoney", () => {
  it("writes lempiras with grouping and two decimals", () => {
    expect(formatMoney(123450)).toBe("L 1,234.50");
    expect(formatMoney(0)).toBe("L 0.00");
    expect(formatMoney(5)).toBe("L 0.05");
    expect(formatMoney(122600)).toBe("L 1,226.00");
    expect(formatMoney(100000000)).toBe("L 1,000,000.00");
  });

  it("writes negatives with U+2212", () => {
    expect(formatMoney(-6400)).toBe("−L 64.00");
    expect(formatMoney(-6400).codePointAt(0)).toBe(0x2212);
  });

  it("rejects non-integer cents", () => {
    expect(() => formatMoney(1.5)).toThrow(ValidationError);
    expect(() => formatMoneyPlain(Number.NaN)).toThrow(ValidationError);
  });
});

describe("formatMoneyPlain", () => {
  it("writes editable text without symbol or commas", () => {
    expect(formatMoneyPlain(123450)).toBe("1234.50");
    expect(formatMoneyPlain(5)).toBe("0.05");
    expect(formatMoneyPlain(-6400)).toBe("-64.00");
  });
});

describe("round trip", () => {
  it("parseMoney(formatMoney(x)) returns x (1000 seeded cases)", () => {
    const rng = mulberry32(20261023);
    for (let i = 0; i < 1000; i += 1) {
      const value = Math.floor(rng() * 10_000_000_001);
      expect(parseMoney(formatMoney(value))).toBe(value);
    }
  });
});

describe("parsePercentBps", () => {
  it("reads editable percentages into basis points", () => {
    expect(parsePercentBps("10")).toBe(1000);
    expect(parsePercentBps("+7")).toBe(700);
    expect(parsePercentBps(" -15.5 % ")).toBe(-1550);
    expect(parsePercentBps("−20")).toBe(-2000); // U+2212
    expect(parsePercentBps("0.05")).toBe(5);
    expect(parsePercentBps("2.5")).toBe(250);
    expect(parsePercentBps("100")).toBe(10000);
  });

  it("never returns negative zero", () => {
    expect(Object.is(parsePercentBps("-0"), 0)).toBe(true);
  });

  it("returns null for anything else", () => {
    for (const text of ["", "abc", "10.555", "1,5", "1000", "--5", "5 5", "%"]) {
      expect(parsePercentBps(text), text).toBeNull();
    }
  });
});

describe("formatPercentBps", () => {
  it("writes basis points as an editable percentage", () => {
    expect(formatPercentBps(1500)).toBe("15");
    expect(formatPercentBps(1550)).toBe("15.5");
    expect(formatPercentBps(75)).toBe("0.75");
    expect(formatPercentBps(5)).toBe("0.05");
    expect(formatPercentBps(0)).toBe("0");
    expect(formatPercentBps(-1500)).toBe("-15");
    expect(formatPercentBps(-50)).toBe("-0.5");
  });

  it("reads back what it writes", () => {
    for (const bps of [0, 5, 50, 75, 1500, 1550, 10000, -2000, -5]) {
      expect(parsePercentBps(formatPercentBps(bps)), String(bps)).toBe(bps);
    }
  });

  it("rejects unsafe numbers", () => {
    expect(() => formatPercentBps(1.5)).toThrow(ValidationError);
  });
});

describe("pluralize", () => {
  it("uses the singular only for exactly one", () => {
    expect(pluralize(1, "prenda", "prendas")).toBe("prenda");
    expect(pluralize(0, "prenda", "prendas")).toBe("prendas");
    expect(pluralize(2, "prenda", "prendas")).toBe("prendas");
    expect(pluralize(12, "venta", "ventas")).toBe("ventas");
  });
});
