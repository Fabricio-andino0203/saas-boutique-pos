"use server";

import { messages } from "@/config/messages.es";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { requireUserCapability } from "@/lib/auth";
import {
  createBoxWithdrawal,
  createFinanceCategory,
  createFinanceEntry,
  createFixedCost,
  payFixedCost,
  renameFinanceCategory,
  setFinanceCategoryArchived,
  setFixedCostArchived,
  updateFixedCost,
  voidBoxWithdrawal,
  voidFinanceEntry,
} from "@/modules/finance/service";
import type {
  BoxWithdrawalInput,
  CategoryInput,
  FinanceEntryInput,
  FixedCostInput,
  PayFixedCostInput,
  VoidBoxWithdrawalInput,
  VoidEntryInput,
} from "@/modules/finance/schemas";

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

/** Retira efectivo de la caja de finanzas (lo que se lleva el dueño o se deposita en el banco). */
export async function createBoxWithdrawalAction(
  input: BoxWithdrawalInput,
): Promise<ActionResult<{ id: string }>> {
  const { user } = await requireUserCapability("finance.write");
  return toActionResult(() => createBoxWithdrawal(user, input), messages.errors);
}

/** Anula un retiro de la caja de finanzas con su motivo (no se borra). */
export async function voidBoxWithdrawalAction(
  input: VoidBoxWithdrawalInput,
): Promise<ActionResult<null>> {
  const { user } = await requireUserCapability("finance.void");
  return toActionResult(async () => {
    await voidBoxWithdrawal(user, input);
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

export async function createFixedCostAction(
  input: FixedCostInput,
): Promise<ActionResult<{ id: string }>> {
  const { user } = await requireUserCapability("finance.write");
  return toActionResult(() => createFixedCost(user, input), messages.errors);
}

export async function updateFixedCostAction(
  fixedCostId: string,
  input: FixedCostInput,
): Promise<ActionResult<null>> {
  const { user } = await requireUserCapability("finance.write");
  return toActionResult(async () => {
    await updateFixedCost(user, String(fixedCostId), input);
    return null;
  }, messages.errors);
}

export async function setFixedCostArchivedAction(
  fixedCostId: string,
  archived: boolean,
): Promise<ActionResult<null>> {
  const { user } = await requireUserCapability("finance.write");
  return toActionResult(async () => {
    await setFixedCostArchived(user, String(fixedCostId), Boolean(archived));
    return null;
  }, messages.errors);
}

/** Registra el pago de un costo fijo en un mes. */
export async function payFixedCostAction(
  input: PayFixedCostInput,
): Promise<ActionResult<{ id: string }>> {
  const { user } = await requireUserCapability("finance.write");
  return toActionResult(() => payFixedCost(user, input), messages.errors);
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
