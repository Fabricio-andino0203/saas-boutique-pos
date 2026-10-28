import { z } from "zod";

import { MAX_SALE_CENTS } from "@/modules/sales/schemas";

const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

/** El cliente rápido de la venta: solo nombre y, si lo hay, teléfono. El resto se completa en la Fase 5. */
export const quickCustomerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  phone: z.preprocess(
    blankToUndefined,
    z
      .string()
      .trim()
      .regex(/^[0-9+() -]{6,20}$/)
      .optional(),
  ),
});

export type QuickCustomerInput = z.input<typeof quickCustomerSchema>;

/** Un ajuste manual del crédito de tienda: suma o resta, siempre con motivo. */
export const adjustCreditSchema = z.object({
  /** Lo genera la pantalla una vez por ajuste: reintentar con el mismo valor no ajusta dos veces. */
  requestId: z.string().min(8).max(64),
  customerId: z.string().min(1).max(40),
  direction: z.enum(["ADD", "SUBTRACT"]),
  amountCents: z.number().int().min(1).max(MAX_SALE_CENTS),
  reason: z.string().trim().min(3).max(200),
});

export type AdjustCreditInput = z.input<typeof adjustCreditSchema>;

const optionalText = (max: number) =>
  z.preprocess(blankToUndefined, z.string().trim().max(max).optional());

/** La ficha completa del cliente: solo el nombre es obligatorio. Un campo vacío se borra. */
export const customerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  phone: z.preprocess(
    blankToUndefined,
    z
      .string()
      .trim()
      .regex(/^[0-9+() -]{6,20}$/)
      .optional(),
  ),
  email: z.preprocess(blankToUndefined, z.string().trim().email().max(120).optional()),
  taxId: optionalText(30),
  notes: optionalText(500),
  preferredSizes: optionalText(120),
});

export type CustomerInput = z.input<typeof customerSchema>;
export type CustomerData = z.output<typeof customerSchema>;
