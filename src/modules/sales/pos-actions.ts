"use server";

import { messages } from "@/config/messages.es";
import { toActionResult } from "@/lib/action-result";
import { requireUserCapability } from "@/lib/auth";
import { quickCustomerSchema, type QuickCustomerInput } from "@/modules/customers/schemas";
import { quickCustomer } from "@/modules/customers/service";
import { lookupCode, searchSellable } from "@/modules/sales/pos-queries";
import type {
  LookupResult,
  PosActionError,
  QuickCustomer,
  SellableProduct,
} from "@/modules/sales/pos-types";

const copy = messages.pos;

/** Busca prendas para vender. Lo llama la pantalla de venta mientras se escribe. */
export async function searchPosAction(input: {
  q?: string;
  categoryId?: string;
}): Promise<{ products: SellableProduct[] } | PosActionError> {
  await requireUserCapability("sale.create");
  const result = await toActionResult(
    () => searchSellable({ q: String(input.q ?? ""), categoryId: input.categoryId || undefined }),
    messages.errors,
  );
  return result.ok ? { products: result.data } : { error: result.error.message };
}

/** Un código exacto (escáner o escrito a mano). */
export async function lookupCodeAction(code: string): Promise<LookupResult | PosActionError> {
  await requireUserCapability("sale.create");
  const result = await toActionResult(() => lookupCode(String(code)), messages.errors);
  return result.ok ? result.data : { error: result.error.message };
}

export async function quickCustomerAction(
  input: QuickCustomerInput,
): Promise<{ customer: QuickCustomer } | PosActionError> {
  const parsed = quickCustomerSchema.safeParse(input);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return { error: field === "phone" ? copy.customer.invalidPhone : copy.customer.invalidName };
  }
  const { user } = await requireUserCapability("sale.create");
  const result = await toActionResult(() => quickCustomer(user, parsed.data), messages.errors);
  return result.ok ? { customer: result.data } : { error: result.error.message };
}
