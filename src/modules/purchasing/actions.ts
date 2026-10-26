"use server";

import { messages } from "@/config/messages.es";
import { toActionResult } from "@/lib/action-result";
import { requireUserCapability } from "@/lib/auth";
import { hasCapability } from "@/lib/permissions";
import { searchPurchasableVariants, type VariantOption } from "@/modules/purchasing/queries";
import {
  purchaseOrderSchema,
  receiptSchema,
  type PurchasingActionState,
} from "@/modules/purchasing/schemas";
import {
  cancelPurchaseOrder,
  createPurchaseOrder,
  placePurchaseOrder,
  receiveGoods,
  updatePurchaseOrder,
} from "@/modules/purchasing/service";

const copy = messages.purchasing;

/** Para el escáner y el buscador: devuelve las prendas que coinciden (con costo solo si se puede ver). */
export async function searchVariantsAction(query: string): Promise<VariantOption[]> {
  const { user } = await requireUserCapability("purchase.receive");
  return searchPurchasableVariants(String(query), {
    includeCost: hasCapability(user.role, "product.viewCost"),
  });
}

export async function savePurchaseOrderAction(
  id: string | null,
  input: unknown,
): Promise<PurchasingActionState> {
  const parsed = purchaseOrderSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? messages.errors.VALIDATION };
  }
  const { user } = await requireUserCapability("purchase.receive");
  const result = await toActionResult(
    async () =>
      id ? (await updatePurchaseOrder(user, id, input), { id }) : createPurchaseOrder(user, input),
    messages.errors,
  );
  return result.ok
    ? { id: result.data.id, success: copy.order.saved }
    : { error: result.error.message };
}

export async function placePurchaseOrderAction(id: string): Promise<PurchasingActionState> {
  const { user } = await requireUserCapability("purchase.receive");
  const result = await toActionResult(() => placePurchaseOrder(user, id), messages.errors);
  return result.ok ? { success: copy.order.placed } : { error: result.error.message };
}

export async function cancelPurchaseOrderAction(id: string): Promise<PurchasingActionState> {
  const { user } = await requireUserCapability("purchase.receive");
  const result = await toActionResult(() => cancelPurchaseOrder(user, id), messages.errors);
  return result.ok ? { success: copy.order.cancelled } : { error: result.error.message };
}

export async function receiveGoodsAction(input: unknown): Promise<PurchasingActionState> {
  const parsed = receiptSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? messages.errors.VALIDATION };
  }
  const { user } = await requireUserCapability("purchase.receive");
  const result = await toActionResult(() => receiveGoods(user, input), messages.errors);
  return result.ok
    ? { id: result.data.id, success: copy.receipt.created }
    : { error: result.error.message };
}
