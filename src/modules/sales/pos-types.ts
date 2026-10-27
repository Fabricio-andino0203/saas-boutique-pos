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
