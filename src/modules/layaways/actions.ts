"use server";

import { messages } from "@/config/messages.es";
import { requireUserCapability } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  AccountLockedError,
  AppError,
  ForbiddenError,
  InsufficientStockError,
  InvalidCredentialsError,
} from "@/lib/errors";
import type {
  AddLayawayPaymentInput,
  CancelLayawayInput,
  CreateLayawayInput,
  SettleLayawayInput,
} from "@/modules/layaways/schemas";
import {
  addLayawayPayment,
  cancelLayaway,
  createLayaway,
  expireOverdueLayaways,
  settleLayaway,
} from "@/modules/layaways/service";

const copy = messages.layaways;

export type LayawayFailure = {
  ok: false;
  /** `NEEDS_APPROVAL`: pedir el PIN de un gerente; `PIN`: el PIN falló; `ERROR`: cualquier otro motivo. */
  code: "NEEDS_APPROVAL" | "PIN" | "ERROR";
  message: string;
};

export type CreateLayawayOutcome =
  | {
      ok: true;
      layaway: {
        id: string;
        number: string;
        totalCents: number;
        paidCents: number;
        balanceCents: number;
        expiresAt: string;
        paymentId: string;
      };
    }
  | LayawayFailure;

export type LayawayPaymentOutcome =
  { ok: true; paymentId: string; paidCents: number; balanceCents: number } | LayawayFailure;

export type SettleLayawayOutcome =
  | {
      ok: true;
      layawayNumber: string;
      sale: {
        id: string;
        number: string;
        totalCents: number;
        paidCents: number;
        changeCents: number;
      };
      fiscalNumber: string | null;
    }
  | LayawayFailure;

export type CancelLayawayOutcome = { ok: true } | LayawayFailure;

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

async function failure(error: unknown, hasOverride: boolean): Promise<LayawayFailure> {
  if (error instanceof InvalidCredentialsError) {
    return { ok: false, code: "PIN", message: copy.errors.pinInvalid };
  }
  if (error instanceof AccountLockedError) {
    return { ok: false, code: "PIN", message: messages.errors.ACCOUNT_LOCKED };
  }
  if (error instanceof ForbiddenError) {
    return hasOverride
      ? { ok: false, code: "PIN", message: copy.errors.pinNotManager }
      : { ok: false, code: "NEEDS_APPROVAL", message: copy.errors.needsManager };
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
  console.error("Error inesperado en un apartado", error);
  return { ok: false, code: "ERROR", message: messages.errors.UNEXPECTED };
}

export async function createLayawayAction(
  input: CreateLayawayInput,
): Promise<CreateLayawayOutcome> {
  const { user } = await requireUserCapability("layaway.manage");
  try {
    const result = await createLayaway(user, input);
    return {
      ok: true,
      layaway: {
        id: result.id,
        number: result.number,
        totalCents: result.totalCents,
        paidCents: result.paidCents,
        balanceCents: result.balanceCents,
        expiresAt: result.expiresAt.toISOString(),
        paymentId: result.paymentId,
      },
    };
  } catch (error) {
    return failure(error, false);
  }
}

export async function addLayawayPaymentAction(
  input: AddLayawayPaymentInput,
): Promise<LayawayPaymentOutcome> {
  const { user } = await requireUserCapability("layaway.manage");
  try {
    const result = await addLayawayPayment(user, input);
    return {
      ok: true,
      paymentId: result.paymentId,
      paidCents: result.paidCents,
      balanceCents: result.balanceCents,
    };
  } catch (error) {
    return failure(error, false);
  }
}

export async function settleLayawayAction(
  input: SettleLayawayInput,
): Promise<SettleLayawayOutcome> {
  const { user } = await requireUserCapability("layaway.manage");
  try {
    const result = await settleLayaway(user, input);
    return {
      ok: true,
      layawayNumber: result.layawayNumber,
      sale: result.sale,
      fiscalNumber: result.fiscalNumber,
    };
  } catch (error) {
    return failure(error, false);
  }
}

export async function cancelLayawayAction(
  input: CancelLayawayInput,
): Promise<CancelLayawayOutcome> {
  const { user } = await requireUserCapability("layaway.manage");
  try {
    await cancelLayaway(user, input);
    return { ok: true };
  } catch (error) {
    return failure(error, Boolean(input.managerOverride));
  }
}

/** Vence los apartados cuyo plazo ya pasó. Lo llaman la lista de apartados y la pantalla de venta al abrirse. */
export async function expireOverdueLayawaysAction(): Promise<{ expired: number }> {
  const { user } = await requireUserCapability("layaway.manage");
  try {
    return { expired: await expireOverdueLayaways(user) };
  } catch (error) {
    console.error("No se pudieron vencer los apartados", error);
    return { expired: 0 };
  }
}
