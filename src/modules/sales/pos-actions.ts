"use server";

import { messages } from "@/config/messages.es";
import { toActionResult } from "@/lib/action-result";
import { requireUserCapability } from "@/lib/auth";
import { quickCustomerSchema, type QuickCustomerInput } from "@/modules/customers/schemas";
import { getCustomerCreditCents, searchCustomers } from "@/modules/customers/queries";
import { quickCustomer } from "@/modules/customers/service";
import { lookupCode, searchSellable } from "@/modules/sales/pos-queries";
import { cancelTicketSchema, type CancelTicketInput } from "@/modules/sales/schemas";
import { logCancelledTicket } from "@/modules/sales/service";
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

/** El crédito de tienda del cliente elegido, para ofrecerlo como forma de pago. */
export async function getCustomerCreditAction(
  customerId: string,
): Promise<{ creditCents: number } | PosActionError> {
  await requireUserCapability("sale.create");
  const result = await toActionResult(
    () => getCustomerCreditCents(String(customerId)),
    messages.errors,
  );
  if (!result.ok) {
    return { error: result.error.message };
  }
  return { creditCents: result.data ?? 0 };
}

/** Deja constancia, con su motivo, de un ticket que se descartó sin cobrar. */
export async function cancelTicketAction(
  input: CancelTicketInput,
): Promise<{ ok: true } | PosActionError> {
  const parsed = cancelTicketSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.path[0] === "reason"
          ? copy.cancel.invalidReason
          : messages.errors.VALIDATION,
    };
  }
  const { user } = await requireUserCapability("sale.create");
  const result = await toActionResult(() => logCancelledTicket(user, parsed.data), messages.errors);
  return result.ok ? { ok: true } : { error: result.error.message };
}

/** Los clientes que coinciden con lo escrito en la caja (nombre o teléfono). */
export async function searchCustomersAction(
  q: string,
): Promise<{ customers: QuickCustomer[] } | PosActionError> {
  await requireUserCapability("sale.create");
  const result = await toActionResult(() => searchCustomers(String(q)), messages.errors);
  return result.ok ? { customers: result.data } : { error: result.error.message };
}
