"use server";

import { messages } from "@/config/messages.es";
import { toActionResult } from "@/lib/action-result";
import { requireUserCapability } from "@/lib/auth";
import {
  applyCount,
  cancelCount,
  openCount,
  reopenCount,
  scanCount,
  setCountedQty,
  submitCountForReview,
  type ScanResult,
} from "@/modules/inventory/counts";
import type { InventoryActionState } from "@/modules/inventory/types";

const copy = messages.counts;

export type OpenCountState = { error: string } | { id: string };

export async function openCountAction(input: {
  scope: string;
  categoryId?: string;
}): Promise<OpenCountState> {
  if (input.scope === "CATEGORY" && !input.categoryId) {
    return { error: copy.form.chooseCategory };
  }
  const { user } = await requireUserCapability("stock.adjust");
  const result = await toActionResult(() => openCount(user, input), messages.errors);
  return result.ok ? { id: result.data.id } : { error: result.error.message };
}

export type ScanState =
  | { status: "ok"; item: Extract<ScanResult, { found: true }>["item"] }
  | { status: "not-found"; message: string }
  | { status: "error"; message: string };

/** Una lectura del escáner: suma (o quita, con delta -1) una unidad contada. */
export async function scanCountAction(
  countId: string,
  code: string,
  delta: number,
): Promise<ScanState> {
  const { user } = await requireUserCapability("stock.adjust");
  const result = await toActionResult(
    () => scanCount(user, countId, String(code), delta === -1 ? -1 : 1),
    messages.errors,
  );
  if (!result.ok) {
    return { status: "error", message: result.error.message };
  }
  return result.data.found
    ? { status: "ok", item: result.data.item }
    : { status: "not-found", message: copy.scanner.notInCount };
}

export async function setCountedQtyAction(
  itemId: string,
  quantity: number,
): Promise<InventoryActionState> {
  const { user } = await requireUserCapability("stock.adjust");
  const result = await toActionResult(() => setCountedQty(user, itemId, quantity), messages.errors);
  return result.ok ? { success: copy.items.saved } : { error: result.error.message };
}

export async function submitCountAction(id: string): Promise<InventoryActionState> {
  const { user } = await requireUserCapability("stock.adjust");
  const result = await toActionResult(() => submitCountForReview(user, id), messages.errors);
  return result.ok ? { success: copy.actions.reviewed } : { error: result.error.message };
}

export async function reopenCountAction(id: string): Promise<InventoryActionState> {
  const { user } = await requireUserCapability("stock.adjust");
  const result = await toActionResult(() => reopenCount(user, id), messages.errors);
  return result.ok ? { success: copy.actions.reopened } : { error: result.error.message };
}

export async function cancelCountAction(id: string): Promise<InventoryActionState> {
  const { user } = await requireUserCapability("stock.adjust");
  const result = await toActionResult(() => cancelCount(user, id), messages.errors);
  return result.ok ? { success: copy.actions.cancelled } : { error: result.error.message };
}

export async function applyCountAction(id: string): Promise<InventoryActionState> {
  const { user } = await requireUserCapability("stock.approveCount");
  const result = await toActionResult(() => applyCount(user, id), messages.errors);
  return result.ok ? { success: copy.actions.approved } : { error: result.error.message };
}
