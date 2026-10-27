import { ValidationError } from "@/lib/errors";
import { sumCents } from "@/lib/money";
import { priceCart, type CartLine, type PricedCart } from "@/modules/sales/calc";
import type { Discount } from "@/modules/sales/schemas";

/** Lógica pura del carrito del punto de venta (sin React ni navegador): así se prueba con valores a mano. */

/** Igual al tope por línea que acepta el servidor. */
export const MAX_LINE_QUANTITY = 9999;

export type CartItem = {
  id: string;
  variantId: string;
  productName: string;
  /** Talla y color, p. ej. `M · Azul`; vacío si la prenda no tiene. */
  variantLabel: string;
  sku: string;
  unitPriceCents: number;
  quantity: number;
  /** Existencia que se vio al agregarla: el servidor decide al cobrar, esto solo avisa antes. */
  maxStock: number;
  taxExempt: boolean;
  discount?: Discount;
};

export type StockRule = { allowNegativeStock: boolean };

export type NewCartItem = Omit<CartItem, "quantity"> & { quantity?: number };

export type CartChange = { items: CartItem[]; capped: boolean; touchedId: string | null };

export function labelOfVariant(variant: {
  sizeName: string | null;
  colorName: string | null;
}): string {
  return [variant.sizeName, variant.colorName].filter(Boolean).join(" · ");
}

function limitOf(maxStock: number, rule: StockRule): number {
  return rule.allowNegativeStock
    ? MAX_LINE_QUANTITY
    : Math.min(MAX_LINE_QUANTITY, Math.max(0, maxStock));
}

/** Agrega una prenda: si ya está en el ticket suma una unidad más, sin pasar de lo que hay en existencia. */
export function addToCart(
  items: readonly CartItem[],
  incoming: NewCartItem,
  rule: StockRule,
): CartChange {
  const quantity = incoming.quantity ?? 1;
  const limit = limitOf(incoming.maxStock, rule);
  const existing = items.find((item) => item.variantId === incoming.variantId);

  if (existing) {
    const wanted = existing.quantity + quantity;
    const next = Math.min(wanted, limit);
    if (next <= existing.quantity) {
      return { items: [...items], capped: true, touchedId: existing.id };
    }
    return {
      items: items.map((item) =>
        item.id === existing.id ? { ...item, quantity: next, maxStock: incoming.maxStock } : item,
      ),
      capped: next < wanted,
      touchedId: existing.id,
    };
  }

  const next = Math.min(quantity, limit);
  if (next <= 0) {
    return { items: [...items], capped: true, touchedId: null };
  }
  return {
    items: [...items, { ...incoming, quantity: next }],
    capped: next < quantity,
    touchedId: incoming.id,
  };
}

/** Cambia la cantidad de una línea: 0 o menos la quita; no pasa de la existencia (salvo que se permita negativa). */
export function setQuantity(
  items: readonly CartItem[],
  id: string,
  quantity: number,
  rule: StockRule,
): CartChange {
  const line = items.find((item) => item.id === id);
  if (!line || !Number.isFinite(quantity)) {
    return { items: [...items], capped: false, touchedId: null };
  }
  const whole = Math.trunc(quantity);
  if (whole <= 0) {
    return { items: items.filter((item) => item.id !== id), capped: false, touchedId: null };
  }
  const next = Math.min(whole, limitOf(line.maxStock, rule));
  return {
    items: items.map((item) => (item.id === id ? { ...item, quantity: Math.max(1, next) } : item)),
    capped: next < whole,
    touchedId: id,
  };
}

export function removeItem(items: readonly CartItem[], id: string): CartItem[] {
  return items.filter((item) => item.id !== id);
}

export function setItemDiscount(
  items: readonly CartItem[],
  id: string,
  discount: Discount | undefined,
): CartItem[] {
  return items.map((item) => (item.id === id ? { ...item, discount } : item));
}

export type CartSummary = {
  /** `null` si el ticket está vacío o el descuento no es válido. */
  priced: PricedCart | null;
  units: number;
  /** Suma de precio × cantidad, antes de cualquier descuento. */
  grossCents: number;
  /** Todos los descuentos juntos (de línea y global). */
  discountCents: number;
  invalidDiscount: boolean;
};

export function toCartLines(items: readonly CartItem[], taxRateBps: number): CartLine[] {
  return items.map((item) => ({
    unitPriceCents: item.unitPriceCents,
    quantity: item.quantity,
    discount: item.discount,
    taxRateBps: item.taxExempt ? 0 : taxRateBps,
  }));
}

/** Los mismos cálculos que hará el servidor al cobrar (`priceCart`), para mostrar el total mientras se arma el ticket. */
export function summarizeCart(
  items: readonly CartItem[],
  discount: Discount | undefined,
  config: { taxRateBps: number; pricesIncludeTax: boolean },
): CartSummary {
  const units = items.reduce((sum, item) => sum + item.quantity, 0);
  if (items.length === 0) {
    return { priced: null, units, grossCents: 0, discountCents: 0, invalidDiscount: false };
  }
  try {
    const priced = priceCart(toCartLines(items, config.taxRateBps), {
      globalDiscount: discount,
      pricesIncludeTax: config.pricesIncludeTax,
    });
    return {
      priced,
      units,
      grossCents: sumCents(priced.lines.map((line) => line.grossCents)),
      discountCents: sumCents(priced.lines.map((line) => line.discountCents)),
      invalidDiscount: false,
    };
  } catch (error) {
    if (error instanceof ValidationError) {
      return { priced: null, units, grossCents: 0, discountCents: 0, invalidDiscount: true };
    }
    throw error;
  }
}
