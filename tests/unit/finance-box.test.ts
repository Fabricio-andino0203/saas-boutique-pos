import { describe, expect, it } from "vitest";

import { computeFinanceBox } from "@/modules/finance/box";

const none = { depositsCents: 0, cashIncomeCents: 0, cashExpenseCents: 0, withdrawalsCents: 0 };

describe("computeFinanceBox", () => {
  it("adds the closing withdrawals and the cash income and subtracts the cash expenses", () => {
    // Retirado en cierres L 7,000.00 + ingresos en efectivo L 500.00 − gastos en efectivo L 1,250.50 = L 6,249.50.
    const box = computeFinanceBox({
      ...none,
      depositsCents: 700_000,
      cashIncomeCents: 50_000,
      cashExpenseCents: 125_050,
    });
    expect(box).toEqual({
      depositsCents: 700_000,
      cashIncomeCents: 50_000,
      cashExpenseCents: 125_050,
      withdrawalsCents: 0,
      balanceCents: 624_950,
      needsReview: false,
    });
  });

  it("subtracts what the owner took out of the box", () => {
    // L 6,249.50 − L 2,000.25 retirados = L 4,249.25.
    const box = computeFinanceBox({
      depositsCents: 700_000,
      cashIncomeCents: 50_000,
      cashExpenseCents: 125_050,
      withdrawalsCents: 200_025,
    });
    expect(box).toMatchObject({
      withdrawalsCents: 200_025,
      balanceCents: 424_925,
      needsReview: false,
    });
  });

  it("starts empty", () => {
    expect(computeFinanceBox(none)).toMatchObject({ balanceCents: 0, needsReview: false });
  });

  it("is exactly zero, not negative, when everything deposited was spent or taken out", () => {
    expect(
      computeFinanceBox({ ...none, depositsCents: 10_000, cashExpenseCents: 10_000 }),
    ).toMatchObject({ balanceCents: 0, needsReview: false });
    expect(
      computeFinanceBox({ ...none, depositsCents: 10_000, withdrawalsCents: 10_000 }),
    ).toMatchObject({ balanceCents: 0, needsReview: false });
  });

  it("shows a negative balance and flags it for review instead of hiding it", () => {
    const box = computeFinanceBox({ ...none, depositsCents: 10_000, cashExpenseCents: 35_000 });
    expect(box).toMatchObject({ balanceCents: -25_000, needsReview: true });
  });
});
