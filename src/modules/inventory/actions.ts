"use server";

import { messages } from "@/config/messages.es";
import { toActionResult } from "@/lib/action-result";
import { requireUserCapability } from "@/lib/auth";
import { adjustStock } from "@/modules/inventory/adjustments";
import { adjustmentSchema } from "@/modules/inventory/reasons";
import type { InventoryActionState } from "@/modules/inventory/types";

const copy = messages.inventory;

export async function adjustStockAction(input: unknown): Promise<InventoryActionState> {
  const parsed = adjustmentSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? messages.errors.VALIDATION };
  }
  const { user } = await requireUserCapability("stock.adjust");
  const result = await toActionResult(() => adjustStock(user, input), messages.errors);
  if (!result.ok) {
    return { error: result.error.message };
  }
  return { success: result.data.delta === 0 ? copy.adjust.noChange : copy.adjust.done };
}
