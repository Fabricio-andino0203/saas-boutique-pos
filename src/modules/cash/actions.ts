"use server";

import { messages } from "@/config/messages.es";
import { toActionResult } from "@/lib/action-result";
import { requireUserCapability } from "@/lib/auth";
import {
  cashMovementSchema,
  closeCashSchema,
  openCashSchema,
  type DenominationCounts,
} from "@/modules/cash/schemas";
import {
  addCashMovement,
  approveCashClose,
  openCashSession,
  previewCashClose,
  submitCashClose,
} from "@/modules/cash/service";
import type { CashActionState, CashCloseState, CashPreviewState } from "@/modules/cash/types";

const copy = messages.cash;

export async function openCashAction(openingFloatCents: number): Promise<CashActionState> {
  if (!openCashSchema.safeParse({ openingFloatCents }).success) {
    return { error: copy.open.invalidFloat };
  }
  const { user } = await requireUserCapability("cash.open");
  const result = await toActionResult(
    () => openCashSession(user, { openingFloatCents }),
    messages.errors,
  );
  return result.ok ? { success: copy.open.opened } : { error: result.error.message };
}

export async function addCashMovementAction(input: {
  type: "IN" | "OUT";
  amountCents: number;
  reason: string;
}): Promise<CashActionState> {
  const parsed = cashMovementSchema.safeParse(input);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return {
      error:
        field === "reason"
          ? copy.movements.invalidReason
          : field === "amountCents"
            ? copy.movements.invalidAmount
            : messages.errors.VALIDATION,
    };
  }
  const { user } = await requireUserCapability("cash.open");
  const result = await toActionResult(() => addCashMovement(user, parsed.data), messages.errors);
  return result.ok ? { success: copy.movements.saved } : { error: result.error.message };
}

/** Compara lo contado con lo esperado, sin cerrar nada. */
export async function previewCashCloseAction(countedCashCents: number): Promise<CashPreviewState> {
  if (!closeCashSchema.safeParse({ countedCashCents }).success) {
    return { error: copy.close.invalidCount };
  }
  const { user } = await requireUserCapability("cash.open");
  const result = await toActionResult(
    () => previewCashClose(user, countedCashCents),
    messages.errors,
  );
  return result.ok ? result.data : { error: result.error.message };
}

export async function submitCashCloseAction(input: {
  countedCashCents: number;
  denominations?: DenominationCounts;
  notes?: string;
}): Promise<CashCloseState> {
  const parsed = closeCashSchema.safeParse(input);
  if (!parsed.success) {
    return { error: copy.close.invalidCount };
  }
  const { user } = await requireUserCapability("cash.open");
  const result = await toActionResult(() => submitCashClose(user, parsed.data), messages.errors);
  if (result.ok) {
    return { id: result.data.id };
  }
  // Con los datos ya revisados, lo único que puede fallar por validación es el comentario faltante.
  return {
    error:
      result.error.code === "VALIDATION" && !parsed.data.notes
        ? copy.close.notesRequired
        : result.error.message,
  };
}

export async function approveCashCloseAction(id: string): Promise<CashActionState> {
  const { user } = await requireUserCapability("cash.closeApprove");
  const result = await toActionResult(() => approveCashClose(user, id), messages.errors);
  return result.ok ? { success: copy.approve.approved } : { error: result.error.message };
}
