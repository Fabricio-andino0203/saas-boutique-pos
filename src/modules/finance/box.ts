import { addCents, subCents } from "@/lib/money";

export type FinanceBox = {
  /** Lo retirado en los cierres de caja: entra a la caja de finanzas sin ser ingreso. */
  depositsCents: number;
  /** Ingresos vigentes pagados en «efectivo fuera de caja». */
  cashIncomeCents: number;
  /** Gastos vigentes pagados en «efectivo fuera de caja». */
  cashExpenseCents: number;
  /** Lo que el dueño retiró de la caja de finanzas (los retiros vigentes). */
  withdrawalsCents: number;
  balanceCents: number;
  /** El saldo sale negativo: hay gastos en efectivo que no vienen de un depósito (por ejemplo, anteriores a esta función). */
  needsReview: boolean;
};

/**
 * El saldo de la caja de finanzas (PRD RF-FIN-11): los depósitos de los cierres + los ingresos en efectivo fuera de caja −
 * los gastos en efectivo fuera de caja − los retiros del dueño (RF-FIN-12). Los depósitos no son ingreso ni gasto, así que no tocan la utilidad neta. Función
 * pura: no consulta nada. Un saldo negativo no se oculta ni se corrige: se marca para revisar.
 */
export function computeFinanceBox(input: {
  depositsCents: number;
  cashIncomeCents: number;
  cashExpenseCents: number;
  withdrawalsCents: number;
}): FinanceBox {
  const balanceCents = subCents(
    subCents(addCents(input.depositsCents, input.cashIncomeCents), input.cashExpenseCents),
    input.withdrawalsCents,
  );
  return { ...input, balanceCents, needsReview: balanceCents < 0 };
}
