"use server";

import { messages } from "@/config/messages.es";
import { requireUserCapability } from "@/lib/auth";
import {
  AccountLockedError,
  AppError,
  ForbiddenError,
  InvalidCredentialsError,
} from "@/lib/errors";
import { voidSaleSchema, type VoidSaleInput } from "@/modules/sales/schemas";
import { voidSale } from "@/modules/sales/service";

const copy = messages.salesHistory.void;

export type VoidOutcome = { ok: true } | { ok: false; message: string };

/**
 * Anula una venta. Quien tiene permiso de anular (gerente, propietario) lo hace con el motivo; un cajero necesita
 * además el usuario y el PIN de un gerente. Aquí solo se traducen los errores a lo que la persona debe hacer.
 */
export async function voidSaleAction(input: {
  saleId: string;
  reason: string;
  managerOverride?: VoidSaleInput["managerOverride"];
}): Promise<VoidOutcome> {
  const { user } = await requireUserCapability("sale.create");
  const parsed = voidSaleSchema.safeParse({
    reason: input.reason,
    managerOverride: input.managerOverride?.username?.trim() ? input.managerOverride : undefined,
  });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return {
      ok: false,
      message: field === "managerOverride" ? copy.pinInvalid : copy.invalidReason,
    };
  }
  try {
    await voidSale(user, String(input.saleId), parsed.data);
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return {
        ok: false,
        message: parsed.data.managerOverride ? copy.pinNotManager : copy.needsManager,
      };
    }
    if (error instanceof InvalidCredentialsError) {
      return { ok: false, message: copy.pinInvalid };
    }
    if (error instanceof AccountLockedError) {
      return { ok: false, message: messages.errors.ACCOUNT_LOCKED };
    }
    if (error instanceof AppError) {
      return { ok: false, message: messages.errors[error.code] };
    }
    console.error("Error inesperado al anular una venta", error);
    return { ok: false, message: messages.errors.UNEXPECTED };
  }
}
