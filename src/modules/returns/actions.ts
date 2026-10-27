"use server";

import { messages } from "@/config/messages.es";
import { requireUserCapability } from "@/lib/auth";
import {
  AccountLockedError,
  ApprovalRequiredError,
  AppError,
  ForbiddenError,
  InvalidCredentialsError,
  ReturnPolicyError,
} from "@/lib/errors";
import { processReturn } from "@/modules/returns/service";
import type { ReturnInput } from "@/modules/returns/schemas";

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
    if (error instanceof ReturnPolicyError || error instanceof ApprovalRequiredError) {
      return {
        ok: false,
        code: "NEEDS_APPROVAL",
        message:
          error instanceof ReturnPolicyError
            ? messages.errors.RETURN_POLICY
            : messages.errors.APPROVAL_REQUIRED,
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
    if (error instanceof AppError) {
      return { ok: false, code: "ERROR", message: messages.errors[error.code] };
    }
    console.error("Error inesperado al registrar una devolución", error);
    return { ok: false, code: "ERROR", message: messages.errors.UNEXPECTED };
  }
}
