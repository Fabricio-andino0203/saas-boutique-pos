"use server";

import { messages } from "@/config/messages.es";
import { requireUserCapability } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { adjustStoreCredit } from "@/modules/customers/credit";
import type { AdjustCreditInput } from "@/modules/customers/schemas";

export type AdjustCreditOutcome =
  { ok: true; balanceCents: number } | { ok: false; message: string };

/** Suma o resta crédito de tienda a mano. El servidor revisa el permiso, el motivo y que el saldo no quede negativo. */
export async function adjustCreditAction(input: AdjustCreditInput): Promise<AdjustCreditOutcome> {
  const { user } = await requireUserCapability("credit.adjust");
  try {
    const result = await adjustStoreCredit(user, input);
    return { ok: true, balanceCents: result.balanceCents };
  } catch (error) {
    if (error instanceof AppError) {
      return { ok: false, message: messages.errors[error.code] };
    }
    console.error("Error inesperado al ajustar el crédito de tienda", error);
    return { ok: false, message: messages.errors.UNEXPECTED };
  }
}
