"use server";

import { messages } from "@/config/messages.es";
import { requireUserCapability } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  AccountLockedError,
  ApprovalRequiredError,
  AppError,
  DiscountNeedsApprovalError,
  ForbiddenError,
  InsufficientStockError,
  InvalidCredentialsError,
  ReturnPolicyError,
} from "@/lib/errors";
import type { ExchangeInput, ReturnInput } from "@/modules/returns/schemas";
import { processExchange, processReturn } from "@/modules/returns/service";

const copy = messages.returns;

export type ReturnOutcome =
  | {
      ok: true;
      doc: { id: string; number: string; refundCents: number; refundMethod: string };
    }
  | {
      ok: false;
      /** `NEEDS_APPROVAL`: pedir el PIN de un gerente; `PIN`: el PIN falló; `ERROR`: cualquier otro motivo. */
      code: "NEEDS_APPROVAL" | "PIN" | "ERROR";
      message: string;
    };

export type ExchangeOutcome =
  | {
      ok: true;
      doc: { id: string; number: string; refundCents: number; refundMethod: string };
      sale: {
        id: string;
        number: string;
        totalCents: number;
        paidCents: number;
        changeCents: number;
        creditAppliedCents: number;
        fiscalNumber: string | null;
      };
    }
  | Extract<ReturnOutcome, { ok: false }>;

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

/** Los errores de negocio que comparten una devolución y un cambio, traducidos a lo que el cajero debe hacer. */
async function failure(
  error: unknown,
  hasOverride: boolean,
): Promise<Extract<ReturnOutcome, { ok: false }>> {
  if (
    error instanceof ReturnPolicyError ||
    error instanceof ApprovalRequiredError ||
    error instanceof DiscountNeedsApprovalError
  ) {
    return {
      ok: false,
      code: "NEEDS_APPROVAL",
      message:
        error instanceof ReturnPolicyError
          ? messages.errors.RETURN_POLICY
          : error instanceof DiscountNeedsApprovalError
            ? messages.errors.DISCOUNT_NEEDS_APPROVAL
            : messages.errors.APPROVAL_REQUIRED,
    };
  }
  if (error instanceof InvalidCredentialsError) {
    return { ok: false, code: "PIN", message: copy.errors.pinInvalid };
  }
  if (error instanceof AccountLockedError) {
    return { ok: false, code: "PIN", message: messages.errors.ACCOUNT_LOCKED };
  }
  if (error instanceof ForbiddenError && hasOverride) {
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
  console.error("Error inesperado al registrar una devolución", error);
  return { ok: false, code: "ERROR", message: messages.errors.UNEXPECTED };
}

/**
 * Registra la devolución. El servidor decide todo (política, cantidades, reembolso): aquí solo se traducen los errores
 * a lo que el cajero necesita hacer, como pedir el PIN de un gerente.
 */
export async function processReturnAction(input: ReturnInput): Promise<ReturnOutcome> {
  const { user } = await requireUserCapability("return.create");
  try {
    const result = await processReturn(user, input);
    return {
      ok: true,
      doc: {
        id: result.id,
        number: result.number,
        refundCents: result.refundCents,
        refundMethod: result.refundMethod,
      },
    };
  } catch (error) {
    return failure(error, Boolean(input.managerOverride));
  }
}

/** Registra un cambio: devuelve prendas y cobra la venta de las nuevas en una sola operación (todo o nada). */
export async function processExchangeAction(input: ExchangeInput): Promise<ExchangeOutcome> {
  const { user } = await requireUserCapability("return.create");
  try {
    const result = await processExchange(user, input);
    if (!result.exchange) {
      throw new Error("An exchange always carries its new sale");
    }
    return {
      ok: true,
      doc: {
        id: result.id,
        number: result.number,
        refundCents: result.refundCents,
        refundMethod: result.refundMethod,
      },
      sale: {
        id: result.exchange.id,
        number: result.exchange.number,
        totalCents: result.exchange.totalCents,
        paidCents: result.exchange.paidCents,
        changeCents: result.exchange.changeCents,
        creditAppliedCents: result.exchange.creditAppliedCents,
        fiscalNumber: result.exchange.fiscalNumber,
      },
    };
  } catch (error) {
    return failure(error, Boolean(input.managerOverride));
  }
}
