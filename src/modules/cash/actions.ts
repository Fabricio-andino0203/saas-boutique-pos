"use server";

import { messages } from "@/config/messages.es";
import { toActionResult } from "@/lib/action-result";
import { requireUserCapability } from "@/lib/auth";
import { CashSessionClosedError, NotFoundError } from "@/lib/errors";
import { currentEntitlements, requireFeature } from "@/lib/entitlements";
import { includesFeature } from "@/lib/tenancy/billing";
import {
  cashMovementSchema,
  closeCashSchema,
  openCashSchema,
  type DenominationCounts,
} from "@/modules/cash/schemas";
import {
  addCashMovement,
  approveCashClose,
  openCashSession,
  previewCashClose,
  submitCashClose,
} from "@/modules/cash/service";
import { getCashSessionDetail, getOpenSessionOf } from "@/modules/cash/queries";
import type {
  CashActionState,
  CashCloseState,
  CashPanelState,
  CashPreviewState,
} from "@/modules/cash/types";
import { listFinanceCategories } from "@/modules/finance/queries";

const copy = messages.cash;

export async function openCashAction(
  openingFloatCents: number,
  openingNotes?: string,
): Promise<CashActionState> {
  const parsed = openCashSchema.safeParse({ openingFloatCents, openingNotes });
  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.path[0] === "openingNotes"
          ? copy.open.invalidNotes
          : copy.open.invalidFloat,
    };
  }
  const { user } = await requireUserCapability("cash.open");
  const result = await toActionResult(() => openCashSession(user, parsed.data), messages.errors);
  if (result.ok) {
    return { success: copy.open.opened };
  }
  // Con el monto y el comentario ya válidos, lo único que puede fallar por validación es el comentario que falta.
  return {
    error:
      result.error.code === "VALIDATION" && !parsed.data.openingNotes
        ? copy.open.notesRequired
        : result.error.message,
  };
}

export async function addCashMovementAction(input: {
  type: "IN" | "OUT";
  amountCents: number;
  reason: string;
  /** Módulo Finanzas: la categoría del gasto (salida) o del ingreso (entrada), si se registra como tal. */
  financeCategoryId?: string;
}): Promise<CashActionState> {
  const parsed = cashMovementSchema.safeParse(input);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return {
      error:
        field === "reason"
          ? copy.movements.invalidReason
          : field === "amountCents"
            ? copy.movements.invalidAmount
            : messages.errors.VALIDATION,
    };
  }
  const { user } = await requireUserCapability("cash.open");
  const result = await toActionResult(async () => {
    if (parsed.data.financeCategoryId) {
      await requireFeature("finance"); // sin el módulo en el plan, la categoría no tiene a dónde ir
    }
    return addCashMovement(user, parsed.data);
  }, messages.errors);
  return result.ok ? { success: copy.movements.saved } : { error: result.error.message };
}

/** Compara lo contado con lo esperado, sin cerrar nada. */
export async function previewCashCloseAction(countedCashCents: number): Promise<CashPreviewState> {
  if (!closeCashSchema.safeParse({ countedCashCents }).success) {
    return { error: copy.close.invalidCount };
  }
  const { user } = await requireUserCapability("cash.open");
  const result = await toActionResult(
    () => previewCashClose(user, countedCashCents),
    messages.errors,
  );
  return result.ok ? result.data : { error: result.error.message };
}

export async function submitCashCloseAction(input: {
  countedCashCents: number;
  /** Lo que se retira del cajón; el resto se queda para mañana. Sin esto no se retira nada. */
  withdrawnCents?: number;
  denominations?: DenominationCounts;
  notes?: string;
}): Promise<CashCloseState> {
  const parsed = closeCashSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.path[0] === "withdrawnCents"
          ? copy.close.invalidWithdrawal
          : copy.close.invalidCount,
    };
  }
  const { user } = await requireUserCapability("cash.open");
  const result = await toActionResult(() => submitCashClose(user, parsed.data), messages.errors);
  if (result.ok) {
    return { id: result.data.id };
  }
  // Con los datos ya revisados, lo único que puede fallar por validación es el comentario faltante.
  return {
    error:
      result.error.code === "VALIDATION" && !parsed.data.notes
        ? copy.close.notesRequired
        : result.error.message,
  };
}

export async function approveCashCloseAction(id: string): Promise<CashActionState> {
  const { user } = await requireUserCapability("cash.closeApprove");
  const result = await toActionResult(() => approveCashClose(user, id), messages.errors);
  return result.ok ? { success: copy.approve.approved } : { error: result.error.message };
}

/** El turno abierto del usuario con lo que necesita el panel «Caja» de Vender; se vuelve a pedir tras cada cambio. */
export async function loadCashPanelAction(): Promise<CashPanelState> {
  const { user } = await requireUserCapability("cash.open");
  const result = await toActionResult(async () => {
    const open = await getOpenSessionOf(user.id);
    if (!open) {
      throw new CashSessionClosedError();
    }
    const detail = await getCashSessionDetail(open.id);
    if (!detail) {
      throw new NotFoundError();
    }
    // Con el módulo Finanzas en el plan, las salidas y entradas se pueden registrar como gasto o ingreso, con su categoría.
    const financeCategories = includesFeature(await currentEntitlements(), "finance")
      ? (await listFinanceCategories()).map(({ id, name, type }) => ({ id, name, type }))
      : null;
    return {
      terminalName: detail.session.terminalName,
      openedAt: detail.session.openedAt.toISOString(),
      openingFloatCents: detail.session.openingFloatCents,
      inheritedFloatCents: detail.session.inheritedFloatCents,
      totals: detail.totals,
      expectedCents: detail.expectedCents,
      sales: { count: detail.sales.count, totalCents: detail.sales.totalCents },
      movements: detail.movements.map((movement) => ({
        id: movement.id,
        type: movement.type,
        amountCents: movement.amountCents,
        reason: movement.reason,
        createdAt: movement.createdAt.toISOString(),
        userName: movement.userName,
      })),
      financeCategories,
    };
  }, messages.errors);
  return result.ok ? { data: result.data } : { error: result.error.message };
}
