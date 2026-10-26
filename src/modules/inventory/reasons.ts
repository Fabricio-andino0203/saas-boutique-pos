import { z } from "zod";

import { messages } from "@/config/messages.es";

const copy = messages.inventory.adjust;

/** Motivos de un ajuste manual y su validación. Vive aparte para que la pantalla lo use sin cargar el servidor. */
export const ADJUSTMENT_REASONS = [
  "WASTE",
  "THEFT",
  "DAMAGE",
  "COUNT_ERROR",
  "GIFT",
  "OTHER",
] as const;

export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

export const adjustmentSchema = z
  .object({
    variantId: z.string().trim().min(1).max(40),
    mode: z.enum(["in", "out", "set"]),
    quantity: z
      .number({ error: copy.validation.quantity })
      .int(copy.validation.quantity)
      .min(0, copy.validation.quantity)
      .max(1_000_000, copy.validation.quantity),
    reason: z.enum(ADJUSTMENT_REASONS, { error: copy.validation.reason }),
    note: z.preprocess(blankToUndefined, z.string().trim().max(200).optional()),
  })
  .refine((value) => value.mode === "set" || value.quantity >= 1, {
    message: copy.validation.quantity,
    path: ["quantity"],
  })
  .refine((value) => value.reason !== "OTHER" || value.note !== undefined, {
    message: copy.validation.note,
    path: ["note"],
  });

export type AdjustmentInput = z.output<typeof adjustmentSchema>;

/** "Merma" o "Otro: se cayó del exhibidor": el motivo que queda en el kardex y en la auditoría. */
export function reasonText(reason: AdjustmentReason, note?: string): string {
  const label = copy.reasons[reason];
  return note ? `${label}: ${note}` : label;
}
