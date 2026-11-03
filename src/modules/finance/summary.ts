import { addCents, roundHalfAwayFromZero, sumCents } from "@/lib/money";

export type CategoryTotal = { categoryId: string; name: string; totalCents: number };

export type FinanceSummary = {
  /** Ventas netas sin ISV (lo cobrado menos lo devuelto, sin el ISV de ambos): la cifra de los reportes. */
  revenueCents: number;
  /** Costo de lo que se vendió, menos lo devuelto que volvió a estar a la venta: la cifra de los reportes. */
  costOfSalesCents: number;
  grossProfitCents: number;
  /** Utilidad bruta ÷ ventas netas, en puntos base (1000 = 10 %). 0 si no hubo ventas. */
  grossMarginBps: number;
  /** Ingresos que no son ventas (aportes, devoluciones de gastos…). */
  otherIncomeCents: number;
  expensesCents: number;
  /** Utilidad bruta + otros ingresos − gastos. */
  netProfitCents: number;
  /** Utilidad neta ÷ ventas netas, en puntos base. 0 si no hubo ventas. */
  netMarginBps: number;
  incomeLines: CategoryTotal[];
  expenseLines: CategoryTotal[];
};

const byTotalThenName = (a: CategoryTotal, b: CategoryTotal): number =>
  b.totalCents - a.totalCents || a.name.localeCompare(b.name, "es");

/**
 * La utilidad neta de un periodo (PRD §4.12, RF-FIN-6). Las ventas y su costo vienen de las mismas consultas de los reportes,
 * así que la utilidad bruta se reconcilia con ellos; los gastos y otros ingresos son los movimientos vigentes de Finanzas
 * (los anulados no cuentan). Función pura: no consulta nada. Los márgenes se calculan sobre las ventas netas, como el de los
 * reportes; si no hubo ventas valen 0 en vez de dividir entre cero.
 */
export function computeFinanceSummary(input: {
  revenueCents: number;
  costOfSalesCents: number;
  income: readonly CategoryTotal[];
  expenses: readonly CategoryTotal[];
}): FinanceSummary {
  const grossProfitCents = input.revenueCents - input.costOfSalesCents;
  const otherIncomeCents = sumCents(input.income.map((line) => line.totalCents));
  const expensesCents = sumCents(input.expenses.map((line) => line.totalCents));
  const netProfitCents = addCents(grossProfitCents, otherIncomeCents) - expensesCents;
  const hasSales = input.revenueCents > 0;

  return {
    revenueCents: input.revenueCents,
    costOfSalesCents: input.costOfSalesCents,
    grossProfitCents,
    // Igual que `marginBps` de los reportes, para que las dos pantallas muestren el mismo margen.
    grossMarginBps: hasSales ? Math.round((grossProfitCents * 10_000) / input.revenueCents) : 0,
    otherIncomeCents,
    expensesCents,
    netProfitCents,
    netMarginBps: hasSales ? roundHalfAwayFromZero(netProfitCents * 10_000, input.revenueCents) : 0,
    incomeLines: [...input.income].sort(byTotalThenName),
    expenseLines: [...input.expenses].sort(byTotalThenName),
  };
}
