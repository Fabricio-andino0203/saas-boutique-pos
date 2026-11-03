import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import {
  CashSessionClosedError,
  CashSessionOpenError,
  CashSessionStateError,
  InsufficientCashError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { requireCapability } from "@/lib/permissions";
import type { Actor } from "@/modules/catalog/service";
import { expectedCashCents, type CashTotals } from "@/modules/cash/expected";
import {
  cashMovementSchema,
  closeCashSchema,
  openCashSchema,
  sumDenominations,
} from "@/modules/cash/schemas";
import { recordCashMovementEntry } from "@/modules/finance/service";

type Tx = Prisma.TransactionClient;
type Client = Tx | PrismaClient;

function firstIssue(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "Invalid input";
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

/** La terminal en la que se abre el turno: por ahora la primera activa (hoy solo hay "Caja 1"). */
export async function getDefaultTerminal(
  client: Client,
): Promise<{ id: string; name: string; locationId: string }> {
  const terminal = await client.terminal.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, locationId: true },
  });
  if (!terminal) {
    throw new ValidationError("There is no active terminal");
  }
  return terminal;
}

export type InheritedFloat = {
  /** Lo que quedó en el cajón: lo contado menos lo retirado al cerrar. */
  cents: number;
  fromSessionId: string;
  closedAt: Date;
  closedByName: string;
};

/**
 * El fondo que ofrece el último cierre de la terminal (PRD RF-CASH-8): lo contado menos lo retirado. Es lo contado, no lo
 * esperado, así una diferencia del arqueo no se arrastra. Un cierre sin retiro declarado (anterior a esta función) no hereda.
 */
export async function getInheritedFloat(
  client: Client,
  terminalId: string,
): Promise<InheritedFloat | null> {
  const last = await client.cashSession.findFirst({
    where: { terminalId, status: { in: ["CLOSED_PENDING_APPROVAL", "CLOSED"] } },
    orderBy: [{ closedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      closedAt: true,
      countedCashCents: true,
      withdrawnCents: true,
      user: { select: { name: true } },
    },
  });
  if (!last || !last.closedAt || last.countedCashCents === null || last.withdrawnCents === null) {
    return null;
  }
  return {
    cents: last.countedCashCents - last.withdrawnCents,
    fromSessionId: last.id,
    closedAt: last.closedAt,
    closedByName: last.user.name,
  };
}

/** Suma lo que entró y salió del cajón en un turno. Solo cuentan las ventas completadas. */
export async function loadCashTotals(client: Client, cashSessionId: string): Promise<CashTotals> {
  const session = await client.cashSession.findUnique({
    where: { id: cashSessionId },
    select: { openingFloatCents: true },
  });
  if (!session) {
    throw new NotFoundError();
  }
  // En secuencia: con una transacción, una sola conexión no puede atender consultas a la vez.
  const cashPayments = await client.payment.aggregate({
    _sum: { amountCents: true },
    where: { cashSessionId, method: "CASH", sale: { status: "COMPLETED" } },
  });
  // Un abono recibido en efectivo está en el cajón aunque el apartado se cancele después (se devuelve como crédito).
  const layawayCash = await client.layawayPayment.aggregate({
    _sum: { amountCents: true },
    where: { cashSessionId, method: "CASH" },
  });
  const change = await client.sale.aggregate({
    _sum: { changeCents: true },
    where: { cashSessionId, status: "COMPLETED" },
  });
  const refunds = await client.returnDoc.aggregate({
    _sum: { refundCents: true },
    where: { cashSessionId, refundMethod: "CASH" },
  });
  const movements = await client.cashMovement.groupBy({
    by: ["type"],
    where: { cashSessionId },
    _sum: { amountCents: true },
  });
  const moved = (type: "IN" | "OUT") =>
    movements.find((movement) => movement.type === type)?._sum.amountCents ?? 0;
  return {
    openingFloatCents: session.openingFloatCents,
    cashPaymentsCents: cashPayments._sum.amountCents ?? 0,
    layawayCashCents: layawayCash._sum.amountCents ?? 0,
    changeGivenCents: change._sum.changeCents ?? 0,
    movementsInCents: moved("IN"),
    movementsOutCents: moved("OUT"),
    cashRefundsCents: refunds._sum.refundCents ?? 0,
  };
}

/** Bloquea la caja abierta del usuario (una sola operación a la vez sobre ella). */
async function lockOwnOpenSession(tx: Tx, userId: string): Promise<{ id: string }> {
  const [session] = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "CashSession" WHERE "userId" = ${userId} AND "status" = 'OPEN' FOR UPDATE
  `;
  if (!session) {
    throw new CashSessionClosedError();
  }
  return session;
}

/**
 * Abre el turno con un fondo inicial. Una sola caja abierta por usuario y por terminal: la terminal
 * se bloquea mientras se decide, y los índices parciales de la base cubren cualquier otra carrera.
 * Si el último cierre dejó un fondo mayor que cero y se abre con otro monto, el comentario es obligatorio y queda en la auditoría.
 */
export async function openCashSession(
  actor: Actor,
  input: unknown,
  client: PrismaClient = db,
): Promise<{ id: string }> {
  requireCapability(actor, "cash.open");
  const parsed = openCashSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(firstIssue(parsed.error));
  }
  try {
    return await client.$transaction(async (tx) => {
      const terminal = await getDefaultTerminal(tx);
      await tx.$queryRaw`SELECT "id" FROM "Terminal" WHERE "id" = ${terminal.id} FOR UPDATE`;
      const open = await tx.cashSession.count({
        where: { status: "OPEN", OR: [{ userId: actor.id }, { terminalId: terminal.id }] },
      });
      if (open > 0) {
        throw new CashSessionOpenError();
      }
      const inherited = await getInheritedFloat(tx, terminal.id);
      const { openingFloatCents, openingNotes } = parsed.data;
      const differs = inherited !== null && openingFloatCents !== inherited.cents;
      if (differs && inherited.cents > 0 && !openingNotes) {
        throw new ValidationError(
          "A comment is required when the float differs from the inherited one",
        );
      }
      const session = await tx.cashSession.create({
        data: {
          terminalId: terminal.id,
          userId: actor.id,
          openingFloatCents,
          inheritedFloatCents: inherited?.cents ?? null,
          openingNotes: differs ? (openingNotes ?? null) : null,
        },
      });
      if (differs) {
        await audit.log(tx, {
          userId: actor.id,
          action: "CASH_FLOAT_ADJUSTED",
          entityType: "CashSession",
          entityId: session.id,
          before: { inheritedFloatCents: inherited.cents },
          after: { openingFloatCents },
          reason: openingNotes,
        });
      }
      return { id: session.id };
    });
  } catch (error) {
    throw isUniqueViolation(error) ? new CashSessionOpenError(undefined, { cause: error }) : error;
  }
}

/**
 * Registra una entrada o salida de efectivo en la caja abierta del usuario, con su motivo.
 * Una salida no puede ser mayor que el efectivo que hay en el cajón.
 */
export async function addCashMovement(
  actor: Actor,
  input: unknown,
  client: PrismaClient = db,
): Promise<{ id: string }> {
  requireCapability(actor, "cash.open");
  const parsed = cashMovementSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(firstIssue(parsed.error));
  }
  const data = parsed.data;
  return client.$transaction(async (tx) => {
    const session = await lockOwnOpenSession(tx, actor.id);
    if (data.type === "OUT") {
      const available = expectedCashCents(await loadCashTotals(tx, session.id));
      if (data.amountCents > available) {
        throw new InsufficientCashError();
      }
    }
    const movement = await tx.cashMovement.create({
      data: {
        cashSessionId: session.id,
        type: data.type,
        amountCents: data.amountCents,
        reason: data.reason,
        userId: actor.id,
      },
    });
    // Con el módulo Finanzas, el mismo movimiento queda enlazado a su gasto o ingreso en la misma transacción.
    if (data.financeCategoryId) {
      await recordCashMovementEntry(tx, {
        actorId: actor.id,
        cashMovementId: movement.id,
        type: data.type,
        categoryId: data.financeCategoryId,
        amountCents: data.amountCents,
        description: data.reason,
      });
    }
    return { id: movement.id };
  });
}

export type CashClosePreview = { expectedCents: number; differenceCents: number };

/** Compara lo contado con lo esperado sin cerrar nada: así el cajero ve la diferencia y puede explicarla. */
export async function previewCashClose(
  actor: Actor,
  countedCashCents: number,
  client: PrismaClient = db,
): Promise<CashClosePreview> {
  requireCapability(actor, "cash.open");
  const parsed = closeCashSchema.safeParse({ countedCashCents });
  if (!parsed.success) {
    throw new ValidationError(firstIssue(parsed.error));
  }
  const session = await client.cashSession.findFirst({
    where: { userId: actor.id, status: "OPEN" },
    select: { id: true },
  });
  if (!session) {
    throw new CashSessionClosedError();
  }
  const expectedCents = expectedCashCents(await loadCashTotals(client, session.id));
  return { expectedCents, differenceCents: parsed.data.countedCashCents - expectedCents };
}

/**
 * Cierra el turno del usuario con su arqueo: guarda lo esperado, lo contado, la diferencia y lo que se retira del cajón
 * (lo demás se queda para el día siguiente), y lo deja pendiente de aprobación. Si hay diferencia, el comentario es obligatorio.
 */
export async function submitCashClose(
  actor: Actor,
  input: unknown,
  client: PrismaClient = db,
): Promise<CashClosePreview & { id: string }> {
  requireCapability(actor, "cash.open");
  const parsed = closeCashSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(firstIssue(parsed.error));
  }
  const data = parsed.data;
  return client.$transaction(async (tx) => {
    const session = await lockOwnOpenSession(tx, actor.id);
    const expectedCents = expectedCashCents(await loadCashTotals(tx, session.id));
    const differenceCents = data.countedCashCents - expectedCents;
    if (differenceCents !== 0 && !data.notes) {
      throw new ValidationError("A comment is required when the count differs");
    }
    await tx.cashSession.update({
      where: { id: session.id },
      data: {
        status: "CLOSED_PENDING_APPROVAL",
        closedAt: new Date(),
        expectedCashCents: expectedCents,
        countedCashCents: data.countedCashCents,
        differenceCents,
        withdrawnCents: data.withdrawnCents,
        notes: data.notes ?? null,
      },
    });
    await audit.log(tx, {
      userId: actor.id,
      action: "CASH_SESSION_CLOSED",
      entityType: "CashSession",
      entityId: session.id,
      after: {
        expectedCents,
        countedCents: data.countedCashCents,
        differenceCents,
        withdrawnCents: data.withdrawnCents,
        leftInDrawerCents: data.countedCashCents - data.withdrawnCents,
        ...(data.denominations && sumDenominations(data.denominations) > 0
          ? { denominations: data.denominations }
          : {}),
      },
      reason: data.notes,
    });
    return { id: session.id, expectedCents, differenceCents };
  });
}

/** El gerente o propietario da por bueno el cierre: la caja queda cerrada de forma definitiva. */
export async function approveCashClose(
  actor: Actor,
  id: string,
  client: PrismaClient = db,
): Promise<void> {
  requireCapability(actor, "cash.closeApprove");
  await client.$transaction(async (tx) => {
    const [session] = await tx.$queryRaw<{ status: string; differenceCents: number | null }[]>`
      SELECT "status", "differenceCents" FROM "CashSession" WHERE "id" = ${id} FOR UPDATE
    `;
    if (!session) {
      throw new NotFoundError();
    }
    if (session.status !== "CLOSED_PENDING_APPROVAL") {
      throw new CashSessionStateError();
    }
    await tx.cashSession.update({
      where: { id },
      data: { status: "CLOSED", approvedById: actor.id },
    });
    await audit.log(tx, {
      userId: actor.id,
      action: "CASH_SESSION_APPROVED",
      entityType: "CashSession",
      entityId: id,
      after: { differenceCents: session.differenceCents },
    });
  });
}
