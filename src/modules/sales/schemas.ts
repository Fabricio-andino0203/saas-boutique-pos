import { z } from "zod";

/** Tope razonable para cualquier monto de una venta (L 10,000,000.00): evita desbordes y errores de dedo. */
export const MAX_SALE_CENTS = 1_000_000_000;

/** Formas de pago que se pueden cobrar. El crédito de tienda siempre está activo, pero pide un cliente con saldo. */
export const SALE_PAYMENT_METHODS = ["CASH", "CARD", "TRANSFER", "OTHER", "STORE_CREDIT"] as const;
export type SalePaymentMethod = (typeof SALE_PAYMENT_METHODS)[number];

/** Un descuento tal como lo pidió el cajero: un porcentaje (puntos base) o un monto fijo. */
export const discountSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("PERCENT"), bps: z.number().int().min(1).max(10000) }),
  z.object({ type: z.literal("AMOUNT"), cents: z.number().int().min(1).max(MAX_SALE_CENTS) }),
]);
export type Discount = z.infer<typeof discountSchema>;

export const saleLineSchema = z.object({
  variantId: z.string().min(1).max(40),
  quantity: z.number().int().min(1).max(9999),
  discount: discountSchema.optional(),
});

export const paymentSchema = z.object({
  method: z.enum(SALE_PAYMENT_METHODS),
  amountCents: z.number().int().min(1).max(MAX_SALE_CENTS),
  reference: z.string().trim().max(60).optional(),
});

/** Gerente (o propietario) que autoriza con su PIN algo que el cajero no puede hacer solo. */
export const managerOverrideSchema = z.object({
  username: z.string().trim().min(1).max(40),
  pin: z.string().regex(/^\d{4,6}$/),
});
export type ManagerOverride = z.infer<typeof managerOverrideSchema>;

const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

export const invoiceSchema = z.object({
  taxId: z.preprocess(blankToUndefined, z.string().trim().max(30).optional()),
  name: z.preprocess(blankToUndefined, z.string().trim().max(120).optional()),
});

export const saleInputSchema = z.object({
  /** Lo genera el cliente una vez por venta: reintentar el cobro con el mismo valor no duplica nada. */
  clientRequestId: z.string().min(8).max(64),
  lines: z.array(saleLineSchema).min(1).max(200),
  /** Descuento global, sobre el subtotal ya con los descuentos de línea. */
  discount: discountSchema.optional(),
  payments: z.array(paymentSchema).min(1).max(6),
  customerId: z.string().min(1).max(40).optional(),
  /** Si viene, se emite factura con CAI (aunque vacío, es "consumidor final"). */
  invoice: invoiceSchema.optional(),
  managerOverride: managerOverrideSchema.optional(),
});

export type SaleInput = z.input<typeof saleInputSchema>;
export type SaleData = z.output<typeof saleInputSchema>;

export const voidSaleSchema = z.object({
  reason: z.string().trim().min(3).max(200),
  managerOverride: managerOverrideSchema.optional(),
});

export type VoidSaleInput = z.input<typeof voidSaleSchema>;

/** Una venta que se arma y se descarta antes de cobrar: queda con su motivo y lo que tenía el ticket. */
export const cancelTicketSchema = z.object({
  reason: z.string().trim().min(3).max(200),
  /** Si era el ticket de la pantalla o uno de los que estaban en espera. */
  source: z.enum(["current", "parked"]),
  lines: z
    .array(
      z.object({
        productName: z.string().trim().min(1).max(200),
        variantLabel: z.string().trim().max(200),
        quantity: z.number().int().min(1).max(9999),
        unitPriceCents: z.number().int().min(0).max(MAX_SALE_CENTS),
      }),
    )
    .min(1)
    .max(200),
});

export type CancelTicketInput = z.input<typeof cancelTicketSchema>;
