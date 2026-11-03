import { z } from "zod";

import { mulCents, sumCents } from "@/lib/money";

/** Billetes y monedas que se cuentan al cerrar la caja, de mayor a menor, en centavos. */
export const DENOMINATIONS_CENTS = [50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100] as const;

/** Tope razonable para cualquier monto de caja (L 10,000,000.00): evita desbordes y errores de dedo. */
export const MAX_CASH_CENTS = 1_000_000_000;

const MAX_DENOMINATION_UNITS = 100_000;

const cents = z.number().int().min(0).max(MAX_CASH_CENTS);

const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

export const openCashSchema = z.object({
  openingFloatCents: cents,
  /** Por qué el fondo no es el que dejó el cierre anterior; el servicio decide cuándo es obligatorio. */
  openingNotes: z.preprocess(blankToUndefined, z.string().trim().min(3).max(300).optional()),
});

export const cashMovementSchema = z.object({
  type: z.enum(["IN", "OUT"]),
  amountCents: cents.min(1),
  reason: z.string().trim().min(3).max(200),
  /** Módulo Finanzas: si viene, la salida es un gasto (o la entrada un ingreso) de esta categoría. */
  financeCategoryId: z.preprocess(blankToUndefined, z.string().trim().min(1).max(64).optional()),
});

/** Cantidad de billetes o monedas por denominación (la clave es la denominación en centavos). */
export type DenominationCounts = Record<string, number>;

/** Total en centavos de lo que dice el desglose por denominaciones. */
export function sumDenominations(counts: DenominationCounts): number {
  return sumCents(
    Object.entries(counts).map(([denomination, quantity]) =>
      mulCents(Number(denomination), quantity),
    ),
  );
}

const allowedDenominations: readonly string[] = DENOMINATIONS_CENTS.map(String);

export const closeCashSchema = z
  .object({
    countedCashCents: cents,
    /** Lo que se retira del cajón al cerrar; lo contado menos esto se queda para el día siguiente. */
    withdrawnCents: cents.default(0),
    denominations: z
      .record(z.string(), z.number().int().min(0).max(MAX_DENOMINATION_UNITS))
      .optional(),
    notes: z.preprocess(blankToUndefined, z.string().trim().min(3).max(500).optional()),
  })
  .superRefine((value, context) => {
    if (value.withdrawnCents > value.countedCashCents) {
      context.addIssue({
        code: "custom",
        path: ["withdrawnCents"],
        message: "The withdrawal is more than the counted cash",
      });
    }
    if (!value.denominations) {
      return;
    }
    if (!Object.keys(value.denominations).every((key) => allowedDenominations.includes(key))) {
      context.addIssue({
        code: "custom",
        path: ["denominations"],
        message: "Unknown denomination",
      });
      return;
    }
    if (sumDenominations(value.denominations) !== value.countedCashCents) {
      context.addIssue({
        code: "custom",
        path: ["countedCashCents"],
        message: "The count does not match the denominations",
      });
    }
  });

export type CloseCashInput = z.input<typeof closeCashSchema>;
