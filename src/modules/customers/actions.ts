"use server";

import { messages } from "@/config/messages.es";
import { requireUserCapability } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { adjustStoreCredit } from "@/modules/customers/credit";
import type { AdjustCreditInput, CustomerInput } from "@/modules/customers/schemas";
import { createCustomer, setCustomerArchived, updateCustomer } from "@/modules/customers/service";

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

export type SaveCustomerOutcome = { ok: true; id: string } | { ok: false; message: string };

/** Crea (sin `id`) o edita (con `id`) la ficha de un cliente. El servidor revisa el permiso y los datos. */
export async function saveCustomerAction(
  input: CustomerInput & { id?: string },
): Promise<SaveCustomerOutcome> {
  const { user } = await requireUserCapability("customer.write");
  const { id, ...data } = input;
  try {
    const saved = id ? await updateCustomer(user, id, data) : await createCustomer(user, data);
    return { ok: true, id: saved.id };
  } catch (error) {
    if (error instanceof AppError) {
      return { ok: false, message: messages.errors[error.code] };
    }
    console.error("Error inesperado al guardar un cliente", error);
    return { ok: false, message: messages.errors.UNEXPECTED };
  }
}

/** Archiva o restaura un cliente. */
export async function setCustomerArchivedAction(
  id: string,
  archived: boolean,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { user } = await requireUserCapability("customer.archive");
  try {
    await setCustomerArchived(user, String(id), Boolean(archived));
    return { ok: true };
  } catch (error) {
    if (error instanceof AppError) {
      return { ok: false, message: messages.errors[error.code] };
    }
    console.error("Error inesperado al archivar un cliente", error);
    return { ok: false, message: messages.errors.UNEXPECTED };
  }
}
