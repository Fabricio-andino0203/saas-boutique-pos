import { z } from "zod";

import {
  discountSchema,
  invoiceSchema,
  managerOverrideSchema,
  paymentSchema,
  saleLineSchema,
} from "@/modules/sales/schemas";

export const RETURN_CONDITIONS = ["RESELLABLE", "DAMAGED"] as const;
export type ReturnCondition = (typeof RETURN_CONDITIONS)[number];

/** Cómo se le devuelve el dinero: crédito de tienda, el mismo método (tarjeta o transferencia) o efectivo. */
export const REFUND_METHODS = ["STORE_CREDIT", "ORIGINAL", "CASH"] as const;
export type RefundChoice = (typeof REFUND_METHODS)[number];

const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

export const returnItemSchema = z.object({
  saleItemId: z.string().min(1).max(40),
  quantity: z.number().int().min(1).max(9999),
  condition: z.enum(RETURN_CONDITIONS),
  reason: z.preprocess(blankToUndefined, z.string().trim().max(120).optional()),
});

export const returnInputSchema = z
  .object({
    /** Lo genera el cliente una vez por devolución: reintentar con el mismo valor no devuelve dos veces. */
    clientRequestId: z.string().min(8).max(64),
    saleId: z.string().min(1).max(40),
    items: z.array(returnItemSchema).min(1).max(100),
    reason: z.string().trim().min(3).max(200),
    refundMethod: z.enum(REFUND_METHODS),
    /** Quien recibe el crédito de tienda, si la venta no tenía cliente. */
    customerId: z.string().min(1).max(40).optional(),
    managerOverride: managerOverrideSchema.optional(),
  })
  .refine(
    (value) => new Set(value.items.map((item) => item.saleItemId)).size === value.items.length,
    {
      path: ["items"],
      message: "A garment line can only appear once in a return",
    },
  );

export type ReturnInput = z.input<typeof returnInputSchema>;
export type ReturnData = z.output<typeof returnInputSchema>;

const uniqueLines = (value: { items: { saleItemId: string }[] }) =>
  new Set(value.items.map((item) => item.saleItemId)).size === value.items.length;

/**
 * Un cambio: lo que se devuelve (como en una devolución) y lo que se lleva (como en una venta). Los pagos cubren solo
 * la diferencia; pueden venir vacíos si lo devuelto vale lo mismo o más que lo nuevo.
 */
export const exchangeInputSchema = z
  .object({
    clientRequestId: z.string().min(8).max(64),
    saleId: z.string().min(1).max(40),
    items: z.array(returnItemSchema).min(1).max(100),
    reason: z.string().trim().min(3).max(200),
    newLines: z.array(saleLineSchema).min(1).max(200),
    discount: discountSchema.optional(),
    payments: z.array(paymentSchema).max(6),
    /** Si lo devuelto vale más que lo nuevo, cómo se le devuelve lo que sobra (por defecto, crédito de tienda). */
    refundMethod: z.enum(REFUND_METHODS).optional(),
    customerId: z.string().min(1).max(40).optional(),
    invoice: invoiceSchema.optional(),
    managerOverride: managerOverrideSchema.optional(),
  })
  .refine(uniqueLines, {
    path: ["items"],
    message: "A garment line can only appear once in a return",
  });

export type ExchangeInput = z.input<typeof exchangeInputSchema>;
export type ExchangeData = z.output<typeof exchangeInputSchema>;
