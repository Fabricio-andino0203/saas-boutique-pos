import { describe, expect, it } from "vitest";

import { expectedCashCents } from "@/modules/cash/expected";
import {
  DENOMINATIONS_CENTS,
  MAX_CASH_CENTS,
  cashMovementSchema,
  closeCashSchema,
  openCashSchema,
  sumDenominations,
} from "@/modules/cash/schemas";

describe("expectedCashCents", () => {
  it("adds float, cash payments and entries, and subtracts change, exits and cash refunds", () => {
    // 50000 + 123450 + 20000 = 193450 entra; 3450 + 15000 + 4000 = 22450 sale; 193450 − 22450 = 171000
    expect(
      expectedCashCents({
        openingFloatCents: 50000,
        cashPaymentsCents: 123450,
        changeGivenCents: 3450,
        movementsInCents: 20000,
        movementsOutCents: 15000,
        layawayCashCents: 0,
        cashRefundsCents: 4000,
      }),
    ).toBe(171000);
  });

  it("takes a cash refund out of the drawer even with no other activity", () => {
    // 25000 de fondo − 10000 reembolsados = 15000
    expect(
      expectedCashCents({
        openingFloatCents: 25000,
        cashPaymentsCents: 0,
        changeGivenCents: 0,
        movementsInCents: 0,
        movementsOutCents: 0,
        layawayCashCents: 0,
        cashRefundsCents: 10000,
      }),
    ).toBe(15000);
  });

  it("is just the float for a shift without activity", () => {
    expect(
      expectedCashCents({
        openingFloatCents: 25000,
        cashPaymentsCents: 0,
        changeGivenCents: 0,
        movementsInCents: 0,
        movementsOutCents: 0,
        layawayCashCents: 0,
        cashRefundsCents: 0,
      }),
    ).toBe(25000);
  });

  it("does not hide a negative result (the service refuses exits that would cause it)", () => {
    expect(
      expectedCashCents({
        openingFloatCents: 1000,
        cashPaymentsCents: 0,
        changeGivenCents: 0,
        movementsInCents: 0,
        movementsOutCents: 1500,
        layawayCashCents: 0,
        cashRefundsCents: 0,
      }),
    ).toBe(-500);
  });
});

describe("sumDenominations", () => {
  it("multiplies each denomination by its quantity", () => {
    // 2 × 50000 + 3 × 1000 + 4 × 100 = 100000 + 3000 + 400
    expect(sumDenominations({ "50000": 2, "1000": 3, "100": 4 })).toBe(103400);
  });

  it("is zero for an empty count", () => {
    expect(sumDenominations({})).toBe(0);
  });

  it("lists the denominations from the biggest to the smallest", () => {
    expect([...DENOMINATIONS_CENTS]).toEqual([...DENOMINATIONS_CENTS].sort((a, b) => b - a));
  });
});

describe("openCashSchema", () => {
  it("accepts a zero float and rejects negatives, decimals and absurd amounts", () => {
    expect(openCashSchema.safeParse({ openingFloatCents: 0 }).success).toBe(true);
    expect(openCashSchema.safeParse({ openingFloatCents: -1 }).success).toBe(false);
    expect(openCashSchema.safeParse({ openingFloatCents: 10.5 }).success).toBe(false);
    expect(openCashSchema.safeParse({ openingFloatCents: Number.NaN }).success).toBe(false);
    expect(openCashSchema.safeParse({ openingFloatCents: MAX_CASH_CENTS + 1 }).success).toBe(false);
  });
});

describe("cashMovementSchema", () => {
  const valid = { type: "OUT", amountCents: 5000, reason: "Pago a proveedor" };

  it("accepts a movement with amount and reason", () => {
    expect(cashMovementSchema.safeParse(valid).success).toBe(true);
  });

  it("requires a positive amount and a real reason", () => {
    expect(cashMovementSchema.safeParse({ ...valid, amountCents: 0 }).success).toBe(false);
    expect(cashMovementSchema.safeParse({ ...valid, reason: "  ab " }).success).toBe(false);
    expect(cashMovementSchema.safeParse({ ...valid, type: "OTHER" }).success).toBe(false);
  });

  it("trims the reason", () => {
    const parsed = cashMovementSchema.parse({ ...valid, reason: "  Cambio  " });
    expect(parsed.reason).toBe("Cambio");
  });
});

describe("closeCashSchema", () => {
  it("accepts a plain count without comment", () => {
    const parsed = closeCashSchema.parse({ countedCashCents: 85000 });
    expect(parsed.notes).toBeUndefined();
  });

  it("treats a blank comment as missing", () => {
    expect(closeCashSchema.parse({ countedCashCents: 0, notes: "   " }).notes).toBeUndefined();
  });

  it("accepts denominations that add up to the count", () => {
    // 1 × 20000 + 2 × 500 = 21000
    expect(
      closeCashSchema.safeParse({
        countedCashCents: 21000,
        denominations: { "20000": 1, "500": 2 },
      }).success,
    ).toBe(true);
  });

  it("rejects denominations that do not add up to the count", () => {
    const result = closeCashSchema.safeParse({
      countedCashCents: 21100,
      denominations: { "20000": 1, "500": 2 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a denomination that does not exist", () => {
    const result = closeCashSchema.safeParse({
      countedCashCents: 30000,
      denominations: { "30000": 1 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a negative or fractional quantity", () => {
    expect(
      closeCashSchema.safeParse({ countedCashCents: 0, denominations: { "100": -1 } }).success,
    ).toBe(false);
    expect(
      closeCashSchema.safeParse({ countedCashCents: 150, denominations: { "100": 1.5 } }).success,
    ).toBe(false);
  });
});
