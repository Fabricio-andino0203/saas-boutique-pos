import { ValidationError } from "@/lib/errors";
import {
  addCents,
  extractTax,
  mulCents,
  percentOf,
  prorateDiscount,
  subCents,
  sumCents,
  type Cents,
} from "@/lib/money";
import type { Discount } from "@/modules/sales/schemas";

export type CartLine = {
  unitPriceCents: Cents;
  quantity: number;
  /** Descuento propio de la línea, tal como lo pidió el cajero. */
  discount?: Discount;
  /** ISV de la línea en puntos base (0 si la prenda está exenta). */
  taxRateBps: number;
};

export type PricedLine = {
  /** Precio × cantidad, antes de cualquier descuento. */
  grossCents: Cents;
  /** Solo el descuento de la línea. */
  ownDiscountCents: Cents;
  /** Lo que se guarda en `SaleItem.lineDiscountCents`: el descuento propio más su parte del descuento global. */
  discountCents: Cents;
  taxCents: Cents;
  /** Lo que el cliente paga por esta línea, ISV incluido. */
  lineTotalCents: Cents;
};

export type PricedCart = {
  lines: PricedLine[];
  /** Σ de las líneas con su descuento propio, antes del descuento global. */
  subtotalCents: Cents;
  /** Descuento global. */
  discountCents: Cents;
  taxCents: Cents;
  totalCents: Cents;
};

/** Cuánto es un descuento sobre una base; nunca puede ser mayor que la base. */
export function discountCentsOf(baseCents: Cents, discount: Discount | undefined): Cents {
  if (!discount) {
    return 0;
  }
  const cents = discount.type === "PERCENT" ? percentOf(baseCents, discount.bps) : discount.cents;
  if (cents > baseCents) {
    throw new ValidationError("A discount cannot be bigger than what it applies to");
  }
  return cents;
}

/**
 * ¿Pasa un descuento del límite de un porcentaje (p. ej. 10 = 10 %)? Un porcentaje se compara tal cual lo
 * pidió el cajero (así 10 % de L 99.99 no "pasa" del 10 % por el redondeo); un monto se compara contra la base.
 */
export function discountExceedsLimit(
  discount: Discount | undefined,
  baseCents: Cents,
  maxPercent: number,
): boolean {
  if (!discount) {
    return false;
  }
  if (discount.type === "PERCENT") {
    return discount.bps > maxPercent * 100;
  }
  return discount.cents * 100 > maxPercent * baseCents;
}

/**
 * Calcula el carrito completo en el servidor: descuentos de línea, descuento global prorrateado entre las
 * líneas (para que una devolución sea exacta) e ISV. El redondeo se hace una sola vez por línea.
 *
 * - Con `pricesIncludeTax` el precio ya trae el ISV: se extrae del total de la línea y el total no cambia.
 * - Sin él, el ISV se suma al precio ya con descuentos.
 */
export function priceCart(
  lines: readonly CartLine[],
  options: { globalDiscount?: Discount; pricesIncludeTax: boolean },
): PricedCart {
  if (lines.length === 0) {
    throw new ValidationError("A sale needs at least one line");
  }
  const grosses = lines.map((line) => mulCents(line.unitPriceCents, line.quantity));
  const owns = lines.map((line, index) => discountCentsOf(grosses[index] as Cents, line.discount));
  const nets = grosses.map((gross, index) => subCents(gross, owns[index] as Cents));
  const subtotalCents = sumCents(nets);

  const discountCents = discountCentsOf(subtotalCents, options.globalDiscount);
  const shares = prorateDiscount(nets, discountCents);

  const priced = lines.map((line, index): PricedLine => {
    const after = subCents(nets[index] as Cents, shares[index] as Cents);
    const taxCents = options.pricesIncludeTax
      ? extractTax(after, line.taxRateBps).taxCents
      : percentOf(after, line.taxRateBps);
    return {
      grossCents: grosses[index] as Cents,
      ownDiscountCents: owns[index] as Cents,
      discountCents: addCents(owns[index] as Cents, shares[index] as Cents),
      taxCents,
      lineTotalCents: options.pricesIncludeTax ? after : addCents(after, taxCents),
    };
  });

  return {
    lines: priced,
    subtotalCents,
    discountCents,
    taxCents: sumCents(priced.map((line) => line.taxCents)),
    totalCents: sumCents(priced.map((line) => line.lineTotalCents)),
  };
}

export type PaymentLine = { method: string; amountCents: Cents };

/**
 * Verifica los pagos contra el total y calcula el vuelto. Se paga al menos el total; solo el efectivo
 * puede pasarse (no se da vuelto de una tarjeta ni de una transferencia).
 */
export function settlePayments(
  totalCents: Cents,
  payments: readonly PaymentLine[],
): { paidCents: Cents; changeCents: Cents } {
  const paidCents = sumCents(payments.map((payment) => payment.amountCents));
  if (paidCents < totalCents) {
    throw new ValidationError("The payments do not cover the total");
  }
  const changeCents = subCents(paidCents, totalCents);
  const cashCents = sumCents(
    payments.filter((payment) => payment.method === "CASH").map((payment) => payment.amountCents),
  );
  if (changeCents > cashCents) {
    throw new ValidationError("Change can only be given from cash");
  }
  return { paidCents, changeCents };
}
