"use server";

import { messages } from "@/config/messages.es";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { requireUserCapability } from "@/lib/auth";
import {
  createFinanceCategory,
  createFinanceEntry,
  renameFinanceCategory,
  setFinanceCategoryArchived,
  voidFinanceEntry,
} from "@/modules/finance/service";
import type { CategoryInput, FinanceEntryInput, VoidEntryInput } from "@/modules/finance/schemas";

/** Registra un gasto o un ingreso que no es venta. El servidor revisa el permiso, el plan y los datos. */
export async function createFinanceEntryAction(
  input: FinanceEntryInput,
): Promise<ActionResult<{ id: string }>> {
  const { user } = await requireUserCapability("finance.write");
  return toActionResult(() => createFinanceEntry(user, input), messages.errors);
}

/** Anula un movimiento con su motivo (no se borra). */
export async function voidFinanceEntryAction(input: VoidEntryInput): Promise<ActionResult<null>> {
  const { user } = await requireUserCapability("finance.void");
  return toActionResult(async () => {
    await voidFinanceEntry(user, input);
    return null;
  }, messages.errors);
}

export async function createFinanceCategoryAction(
  input: CategoryInput,
): Promise<ActionResult<{ id: string }>> {
  const { user } = await requireUserCapability("finance.write");
  return toActionResult(() => createFinanceCategory(user, input), messages.errors);
}

export async function renameFinanceCategoryAction(
  categoryId: string,
  name: string,
): Promise<ActionResult<null>> {
  const { user } = await requireUserCapability("finance.write");
  return toActionResult(async () => {
    await renameFinanceCategory(user, String(categoryId), { name });
    return null;
  }, messages.errors);
}

export async function setFinanceCategoryArchivedAction(
  categoryId: string,
  archived: boolean,
): Promise<ActionResult<null>> {
  const { user } = await requireUserCapability("finance.write");
  return toActionResult(async () => {
    await setFinanceCategoryArchived(user, String(categoryId), Boolean(archived));
    return null;
  }, messages.errors);
}
