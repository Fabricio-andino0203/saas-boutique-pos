import { subCents, sumCents, type Cents } from "@/lib/money";

/** Lo que entró y salió del cajón durante un turno, ya sumado. */
export type CashTotals = {
  openingFloatCents: Cents;
  /** Efectivo recibido en cobros de ventas completadas (lo que entregó el cliente, vuelto incluido). */
  cashPaymentsCents: Cents;
  /** Vuelto entregado en esas ventas. */
  changeGivenCents: Cents;
  movementsInCents: Cents;
  movementsOutCents: Cents;
};

/**
 * Efectivo que debería haber en la caja: fondo + cobros en efectivo − vuelto + entradas − salidas.
 * Las ventas anuladas no cuentan (el servicio solo suma ventas completadas). Cuando existan los
 * reembolsos en efectivo de las devoluciones (Fase 4) se restan aquí también.
 */
export function expectedCashCents(totals: CashTotals): Cents {
  return subCents(
    sumCents([totals.openingFloatCents, totals.cashPaymentsCents, totals.movementsInCents]),
    sumCents([totals.changeGivenCents, totals.movementsOutCents]),
  );
}
