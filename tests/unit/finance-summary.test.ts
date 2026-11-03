import { describe, expect, it } from "vitest";

import { computeFinanceSummary, type CategoryTotal } from "@/modules/finance/summary";

const line = (name: string, totalCents: number): CategoryTotal => ({
  categoryId: name.toLowerCase(),
  name,
  totalCents,
});

describe("computeFinanceSummary", () => {
  it("derives gross and net profit and both margins", () => {
    // Ventas netas L 1,000.00, costo L 400.00 → bruta L 600.00 (60 %).
    // + L 50.00 de otros ingresos − (L 150.00 + L 50.00) de gastos → neta L 450.00 (45 %).
    const summary = computeFinanceSummary({
      revenueCents: 100_000,
      costOfSalesCents: 40_000,
      income: [line("Aporte del dueño", 5_000)],
      expenses: [line("Alquiler", 15_000), line("Publicidad", 5_000)],
    });
    expect(summary).toMatchObject({
      revenueCents: 100_000,
      costOfSalesCents: 40_000,
      grossProfitCents: 60_000,
      grossMarginBps: 6_000,
      otherIncomeCents: 5_000,
      expensesCents: 20_000,
      netProfitCents: 45_000,
      netMarginBps: 4_500,
    });
  });

  it("can be a loss: expenses above the gross profit give a negative net profit and margin", () => {
    // Bruta L 600.00 − gastos L 700.00 = −L 100.00 sobre ventas de L 1,000.00 → −10 %.
    const summary = computeFinanceSummary({
      revenueCents: 100_000,
      costOfSalesCents: 40_000,
      income: [],
      expenses: [line("Alquiler", 70_000)],
    });
    expect(summary.netProfitCents).toBe(-10_000);
    expect(summary.netMarginBps).toBe(-1_000);
  });

  it("has no margin, and no division by zero, when there were no sales", () => {
    const summary = computeFinanceSummary({
      revenueCents: 0,
      costOfSalesCents: 0,
      income: [line("Otros ingresos", 3_000)],
      expenses: [line("Alquiler", 8_000)],
    });
    expect(summary.grossMarginBps).toBe(0);
    expect(summary.netMarginBps).toBe(0);
    expect(summary.netProfitCents).toBe(-5_000);
  });

  it("is all zeros for an empty period", () => {
    expect(
      computeFinanceSummary({ revenueCents: 0, costOfSalesCents: 0, income: [], expenses: [] }),
    ).toEqual({
      revenueCents: 0,
      costOfSalesCents: 0,
      grossProfitCents: 0,
      grossMarginBps: 0,
      otherIncomeCents: 0,
      expensesCents: 0,
      netProfitCents: 0,
      netMarginBps: 0,
      incomeLines: [],
      expenseLines: [],
    });
  });

  it("rounds the margins to whole basis points the way the reports do", () => {
    // Bruta 1 de 3 = 33.33… % → 3,333 bps; neta igual sin gastos.
    const summary = computeFinanceSummary({
      revenueCents: 300,
      costOfSalesCents: 200,
      income: [],
      expenses: [],
    });
    expect(summary.grossMarginBps).toBe(3_333);
    expect(summary.netMarginBps).toBe(3_333);
    // 2 de 3 = 66.66… % → 6,667 (la mitad hacia arriba, no se corta).
    const two = computeFinanceSummary({
      revenueCents: 300,
      costOfSalesCents: 100,
      income: [],
      expenses: [],
    });
    expect(two.grossMarginBps).toBe(6_667);
  });

  it("orders the lines from the largest to the smallest, ties by name, without touching the input", () => {
    const expenses = [line("Publicidad", 5_000), line("Alquiler", 15_000), line("Empaques", 5_000)];
    const summary = computeFinanceSummary({
      revenueCents: 0,
      costOfSalesCents: 0,
      income: [],
      expenses,
    });
    expect(summary.expenseLines.map((entry) => entry.name)).toEqual([
      "Alquiler",
      "Empaques",
      "Publicidad",
    ]);
    expect(expenses.map((entry) => entry.name)).toEqual(["Publicidad", "Alquiler", "Empaques"]);
  });
});
