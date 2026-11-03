import { z } from "zod";

import { parseLocalDateKey } from "@/lib/dates";
import { PERIOD_PATTERN } from "@/modules/finance/periods";

/** Tope razonable para cualquier monto de Finanzas (L 10,000,000.00): evita desbordes y errores de dedo. */
export const MAX_FINANCE_CENTS = 1_000_000_000;

export const FINANCE_ENTRY_TYPES = ["EXPENSE", "INCOME"] as const;
export type FinanceType = (typeof FINANCE_ENTRY_TYPES)[number];

/** Las formas de pago que se eligen a mano. «Efectivo de la caja» no está: nace de la salida de caja (RF-FIN-4). */
export const MANUAL_PAYMENT_METHODS = ["CASH_OTHER", "TRANSFER", "CARD", "OTHER"] as const;
export type ManualPaymentMethod = (typeof MANUAL_PAYMENT_METHODS)[number];

/** Todas las formas de pago que puede tener un movimiento guardado. */
export const ALL_PAYMENT_METHODS = ["CASH_DRAWER", ...MANUAL_PAYMENT_METHODS] as const;
export type PaymentMethod = (typeof ALL_PAYMENT_METHODS)[number];

const id = z.string().trim().min(1).max(64);
const cents = z.number().int().min(1).max(MAX_FINANCE_CENTS);
const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const dateKey = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => parseLocalDateKey(value) !== null, { message: "Invalid date" });

const requestId = z.string().trim().min(8).max(64);

const description = z.string().trim().min(3).max(200);

/** Un gasto o un ingreso que no es venta. La fecha es el día local (`2026-11-03`); no puede ser futura. */
export const financeEntrySchema = z.object({
  type: z.enum(FINANCE_ENTRY_TYPES),
  categoryId: id,
  amountCents: cents,
  occurredOn: dateKey,
  paidWith: z.enum(MANUAL_PAYMENT_METHODS),
  description,
  supplierId: z.preprocess(blankToUndefined, id.optional()),
  clientRequestId: requestId,
});
export type FinanceEntryInput = z.input<typeof financeEntrySchema>;

export const voidEntrySchema = z.object({
  entryId: id,
  reason: z.string().trim().min(3).max(200),
});
export type VoidEntryInput = z.input<typeof voidEntrySchema>;

export const categorySchema = z.object({
  type: z.enum(FINANCE_ENTRY_TYPES),
  name: z.string().trim().min(2).max(60),
});
export type CategoryInput = z.input<typeof categorySchema>;

export const renameCategorySchema = z.object({
  name: z.string().trim().min(2).max(60),
});

const period = z.string().regex(PERIOD_PATTERN);

/** Un costo fijo mensual: del mes en que empieza (y, si ya terminó, el último), con su día de pago (1–28). */
export const fixedCostSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    categoryId: id,
    amountCents: cents,
    dueDay: z.number().int().min(1).max(28),
    startsOn: period,
    endsOn: z.preprocess(blankToUndefined, period.optional()),
  })
  .refine((value) => !value.endsOn || value.endsOn >= value.startsOn, {
    message: "The end month is before the start month",
    path: ["endsOn"],
  });
export type FixedCostInput = z.input<typeof fixedCostSchema>;

/** El pago de un costo fijo en un mes: el monto parte del habitual pero se puede ajustar (la luz cambia cada mes). */
export const payFixedCostSchema = z.object({
  fixedCostId: id,
  period,
  amountCents: cents,
  occurredOn: dateKey,
  paidWith: z.enum(MANUAL_PAYMENT_METHODS),
  clientRequestId: requestId,
});
export type PayFixedCostInput = z.input<typeof payFixedCostSchema>;
