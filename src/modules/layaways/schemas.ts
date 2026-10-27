import { z } from "zod";

import {
  invoiceSchema,
  managerOverrideSchema,
  MAX_SALE_CENTS,
  paymentSchema,
} from "@/modules/sales/schemas";

/** Con qué se abona un apartado: el crédito de tienda se usa al saldar, no para abonar. */
export const LAYAWAY_PAYMENT_METHODS = ["CASH", "CARD", "TRANSFER", "OTHER"] as const;
export type LayawayPaymentMethod = (typeof LAYAWAY_PAYMENT_METHODS)[number];

export const layawayPaymentSchema = z.object({
  method: z.enum(LAYAWAY_PAYMENT_METHODS),
  amountCents: z.number().int().min(1).max(MAX_SALE_CENTS),
  reference: z.string().trim().max(60).optional(),
});

export const createLayawayInputSchema = z.object({
  /** Lo genera la pantalla una vez por apartado: reintentar con él no lo duplica. */
  clientRequestId: z.string().min(8).max(64),
  customerId: z.string().min(1).max(40),
  lines: z
    .array(
      z.object({
        variantId: z.string().min(1).max(40),
        quantity: z.number().int().min(1).max(9999),
      }),
    )
    .min(1)
    .max(200),
  /** El abono inicial: tiene que alcanzar el mínimo que pide la tienda. */
  deposit: layawayPaymentSchema,
});

export type CreateLayawayInput = z.input<typeof createLayawayInputSchema>;

export const addLayawayPaymentSchema = z.object({
  clientRequestId: z.string().min(8).max(64),
  layawayId: z.string().min(1).max(40),
  payment: layawayPaymentSchema,
});

export type AddLayawayPaymentInput = z.input<typeof addLayawayPaymentSchema>;

/** Saldar: lo que falta se cobra con los pagos de siempre (puede quedar vacío si ya se abonó todo). */
export const settleLayawayInputSchema = z.object({
  clientRequestId: z.string().min(8).max(64),
  layawayId: z.string().min(1).max(40),
  payments: z.array(paymentSchema).max(6),
  invoice: invoiceSchema.optional(),
});

export type SettleLayawayInput = z.input<typeof settleLayawayInputSchema>;

export const cancelLayawayInputSchema = z.object({
  layawayId: z.string().min(1).max(40),
  reason: z.string().trim().min(3).max(200),
  /** Lo que la tienda se queda de lo abonado; el resto pasa a crédito de tienda. Por defecto, nada. */
  retainCents: z.number().int().min(0).max(MAX_SALE_CENTS).optional(),
  managerOverride: managerOverrideSchema.optional(),
});

export type CancelLayawayInput = z.input<typeof cancelLayawayInputSchema>;
