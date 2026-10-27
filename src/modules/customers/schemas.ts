import { z } from "zod";

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
