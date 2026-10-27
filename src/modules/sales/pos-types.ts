import type { InvoicingState } from "@/modules/fiscal/alerts";
import type { RefundChoice, ReturnCondition } from "@/modules/returns/schemas";
import type { SalePaymentMethod } from "@/modules/sales/schemas";

/** Tipos que comparten el servidor y la pantalla del punto de venta (sin código de servidor). */

export type SellableVariant = {
  variantId: string;
  sku: string;
  barcode: string;
  sizeName: string | null;
  colorName: string | null;
  colorHex: string | null;
  priceCents: number;
  onHand: number;
  taxExempt: boolean;
};

export type SellableProduct = {
  productId: string;
  code: string;
  name: string;
  categoryName: string;
  variants: SellableVariant[];
};

/** Lo que devuelve escanear o escribir un código exacto. */
export type LookupResult =
  | { kind: "variant"; productName: string; variant: SellableVariant }
  | { kind: "product"; product: SellableProduct }
  | { kind: "none" };

export type PosCategory = { id: string; name: string };

export type QuickCustomer = { id: string; name: string; phone: string | null };

/** Lo que la pantalla necesita saber del negocio y de quien vende, leído en el servidor. */
export type PosConfig = {
  terminalName: string;
  openedByName: string;
  taxRateBps: number;
  pricesIncludeTax: boolean;
  allowNegativeStock: boolean;
  /** Si se puede facturar hoy con el rango de la terminal y qué rangos hay que renovar. */
  invoicing: InvoicingState;
  /** Formas de pago que el negocio tiene activas (ajuste `payments.enabled`). */
  enabledPaymentMethods: SalePaymentMethod[];
  /** Límite de descuento del cajero, en porcentaje (10 = 10 %). */
  cashierDiscountPercent: number;
  /** Gerente y propietario descuentan sin límite. */
  canDiscountBeyondLimit: boolean;
};

export type PosActionError = { error: string };

/** Lo que la pantalla necesita saber de una venta recién cobrada. */
export type SoldSale = {
  id: string;
  number: string;
  totalCents: number;
  paidCents: number;
  changeCents: number;
  /** Número de factura con CAI, si se emitió. */
  fiscalNumber: string | null;
};

export type ChargeOutcome =
  | { ok: true; sale: SoldSale }
  | {
      ok: false;
      /** `NEEDS_APPROVAL`: pedir el PIN de un gerente; `PIN`: el PIN falló; `ERROR`: cualquier otro motivo. */
      code: "NEEDS_APPROVAL" | "PIN" | "ERROR";
      message: string;
    };

/**
 * Un cambio en curso: lo que el cliente devuelve, ya elegido en la pantalla de devoluciones, mientras en el POS se arma
 * lo que se lleva. El valor es solo para mostrar: el servidor lo vuelve a calcular al registrar.
 */
export type ExchangeContext = {
  /** Una vez por cambio: reintentar el registro con él no lo duplica. */
  requestId: string;
  saleId: string;
  saleNumber: string;
  items: { saleItemId: string; quantity: number; condition: ReturnCondition }[];
  units: number;
  reason: string;
  /** Lo que valen las prendas que vuelven (con descuentos e ISV, prorrateado). */
  valueCents: number;
  /** Cómo se devuelve lo que sobre si lo nuevo vale menos. */
  refundMethod: RefundChoice;
  originalRefundable: boolean;
};

/** Lo que la pantalla necesita saber de un cambio recién registrado. */
export type SoldExchange = {
  doc: { id: string; number: string; refundCents: number; refundMethod: string };
  creditAppliedCents: number;
};
