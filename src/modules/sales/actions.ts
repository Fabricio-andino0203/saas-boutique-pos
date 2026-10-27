"use server";

import { messages } from "@/config/messages.es";
import { requireUserCapability } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  AccountLockedError,
  AppError,
  DiscountNeedsApprovalError,
  ForbiddenError,
  InsufficientStockError,
  InvalidCredentialsError,
} from "@/lib/errors";
import type { ChargeOutcome } from "@/modules/sales/pos-types";
import type { SaleInput } from "@/modules/sales/schemas";
import { completeSale } from "@/modules/sales/service";

const copy = messages.pos.charge;

/** "Camisa Oxford · L · Azul", para decirle al cajero cuál prenda no alcanzó. */
async function describeVariant(variantId: string | undefined): Promise<string | null> {
  if (!variantId) {
    return null;
  }
  const variant = await db.variant.findUnique({
    where: { id: variantId },
    select: {
      product: { select: { name: true } },
      size: { select: { name: true } },
      color: { select: { name: true } },
    },
  });
  if (!variant) {
    return null;
  }
  return [variant.product.name, variant.size?.name, variant.color?.name]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Cobra la venta del ticket. El servidor vuelve a calcular todo: aquí solo se traducen los errores a lo que el
 * cajero necesita hacer (pedir el PIN de un gerente, quitar la prenda que no alcanzó, abrir la caja…).
 */
export async function completeSaleAction(input: SaleInput): Promise<ChargeOutcome> {
  const { user } = await requireUserCapability("sale.create");
  try {
    const sale = await completeSale(user, input);
    return {
      ok: true,
      sale: {
        id: sale.id,
        number: sale.number,
        totalCents: sale.totalCents,
        paidCents: sale.paidCents,
        changeCents: sale.changeCents,
        fiscalNumber: sale.fiscalNumber,
      },
    };
  } catch (error) {
    if (error instanceof DiscountNeedsApprovalError) {
      return {
        ok: false,
        code: "NEEDS_APPROVAL",
        message: messages.errors.DISCOUNT_NEEDS_APPROVAL,
      };
    }
    if (error instanceof InvalidCredentialsError) {
      return { ok: false, code: "PIN", message: copy.errors.pinInvalid };
    }
    if (error instanceof AccountLockedError) {
      return { ok: false, code: "PIN", message: messages.errors.ACCOUNT_LOCKED };
    }
    if (error instanceof ForbiddenError && input.managerOverride) {
      return { ok: false, code: "PIN", message: copy.errors.pinNotManager };
    }
    if (error instanceof InsufficientStockError) {
      const item = await describeVariant(error.variantId);
      return {
        ok: false,
        code: "ERROR",
        message: item
          ? `${messages.errors.INSUFFICIENT_STOCK} (${item})`
          : messages.errors.INSUFFICIENT_STOCK,
      };
    }
    if (error instanceof AppError) {
      return { ok: false, code: "ERROR", message: messages.errors[error.code] };
    }
    console.error("Error inesperado al cobrar", error);
    return { ok: false, code: "ERROR", message: messages.errors.UNEXPECTED };
  }
}
