import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { RefundMethod } from "@/generated/prisma/enums";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { nextDocumentNumber } from "@/lib/document-number";
import {
  ApprovalRequiredError,
  CashSessionClosedError,
  ConflictError,
  CustomerRequiredError,
  InsufficientCashError,
  NotFoundError,
  OverReturnError,
  ReturnPolicyError,
  SaleStateError,
  ValidationError,
} from "@/lib/errors";
import { sumCents } from "@/lib/money";
import { hasCapability, requireCapability } from "@/lib/permissions";
import { authorizeWithManagerPin } from "@/modules/auth/manager-override";
import type { SessionUser } from "@/modules/auth/service";
import type { Actor } from "@/modules/catalog/service";
import { expectedCashCents } from "@/modules/cash/expected";
import { getDefaultTerminal, loadCashTotals } from "@/modules/cash/service";
import { applyStoreCredit } from "@/modules/credit/service";
import { recordMovement } from "@/modules/inventory/service";
import { valueOfUnits } from "@/modules/returns/calc";
import { evaluateReturnPolicy } from "@/modules/returns/policy";
import { returnInputSchema, type ReturnData } from "@/modules/returns/schemas";

type Tx = Prisma.TransactionClient;

export type ProcessedReturn = {
  id: string;
  /** Número del comprobante (`DV-000012`). */
  number: string;
  refundCents: number;
  refundMethod: RefundMethod;
  /** `true` si la devolución ya estaba registrada con ese `clientRequestId` y no se hizo nada nuevo. */
  replayed: boolean;
};

export const RETURN_STOCK_REASON = "Devolución";
export const SCRAP_STOCK_REASON = "Merma por devolución";

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

async function findReplay(
  client: Pick<PrismaClient, "returnDoc">,
  clientRequestId: string,
  actorId: string,
): Promise<ProcessedReturn | null> {
  const doc = await client.returnDoc.findUnique({
    where: { clientRequestId },
    select: { id: true, number: true, refundCents: true, refundMethod: true, processedById: true },
  });
  if (!doc) {
    return null;
  }
  if (doc.processedById !== actorId) {
    throw new ConflictError();
  }
  return {
    id: doc.id,
    number: doc.number,
    refundCents: doc.refundCents,
    refundMethod: doc.refundMethod,
    replayed: true,
  };
}

/**
 * Registra una devolución de prendas de una venta ya cobrada.
 *
 * - No se devuelve más de lo vendido (ni sumando devoluciones parciales): la venta se bloquea mientras se decide.
 * - El reembolso es la suma de lo que pagó el cliente por cada unidad (prorrateo exacto, `returns/calc.ts`).
 * - La política (plazo y categorías sin devolución) pide la autorización de un gerente (`return.overridePolicy`),
 *   igual que reembolsar en efectivo (`return.refundCash`); el PIN se verifica fuera de la transacción.
 * - Cada prenda vuelve al inventario (`RETURN_IN`); si llegó dañada, sale enseguida como merma (`RETURN_SCRAP`).
 * - Crédito de tienda al libro del cliente; efectivo, del cajón del turno abierto (baja el esperado de caja).
 * - Idempotente por `clientRequestId`.
 */
export async function processReturn(
  actor: Actor,
  input: unknown,
  client: PrismaClient = db,
  now: Date = new Date(),
): Promise<ProcessedReturn> {
  requireCapability(actor, "return.create");
  const parsed = returnInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const data = parsed.data;

  const existing = await findReplay(client, data.clientRequestId, actor.id);
  if (existing) {
    return existing;
  }

  // El PIN se verifica fuera de la transacción: un PIN malo cuenta como intento fallido aunque esta se revierta.
  const authorizer: SessionUser | null = data.managerOverride
    ? await authorizeWithManagerPin("return.overridePolicy", data.managerOverride, client)
    : null;

  try {
    return await client.$transaction((tx) => runReturn(tx, actor, data, authorizer, now), {
      timeout: 30_000,
      maxWait: 10_000,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const replay = await findReplay(client, data.clientRequestId, actor.id);
      if (replay) {
        return replay;
      }
    }
    throw error;
  }
}

async function runReturn(
  tx: Tx,
  actor: Actor,
  data: ReturnData,
  authorizer: SessionUser | null,
  now: Date,
): Promise<ProcessedReturn> {
  // Dos envíos con el mismo identificador se atienden uno tras otro: el segundo ya ve la devolución del primero.
  await tx.$queryRaw`
    SELECT 1 AS "locked" FROM (SELECT pg_advisory_xact_lock(hashtext(${`return:${data.clientRequestId}`}))) AS "lock"
  `;
  const replay = await findReplay(tx, data.clientRequestId, actor.id);
  if (replay) {
    return replay;
  }

  // La venta se bloquea: dos devoluciones (o una devolución y una anulación) de la misma venta se atienden en fila.
  const [sale] = await tx.$queryRaw<
    {
      id: string;
      status: string;
      createdAt: Date;
      customerId: string | null;
      locationId: string;
    }[]
  >`
    SELECT "id", "status", "createdAt", "customerId", "locationId"
    FROM "Sale" WHERE "id" = ${data.saleId} FOR UPDATE
  `;
  if (!sale) {
    throw new NotFoundError();
  }
  if (sale.status !== "COMPLETED") {
    throw new SaleStateError();
  }

  // El reembolso sale del turno abierto de la terminal (aunque la venta sea de un turno anterior).
  const terminal = await getDefaultTerminal(tx);
  const [session] = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "CashSession"
    WHERE "terminalId" = ${terminal.id} AND "status" = 'OPEN'
    FOR SHARE
  `;
  if (!session) {
    throw new CashSessionClosedError();
  }

  const saleItems = await tx.saleItem.findMany({
    where: { saleId: sale.id },
    select: {
      id: true,
      variantId: true,
      quantity: true,
      unitCostCents: true,
      lineTotalCents: true,
    },
  });
  const itemById = new Map(saleItems.map((item) => [item.id, item]));
  const priorReturns = await tx.returnItem.groupBy({
    by: ["saleItemId"],
    where: { saleItemId: { in: saleItems.map((item) => item.id) } },
    _sum: { quantity: true },
  });
  const returnedBefore = new Map(
    priorReturns.map((row) => [row.saleItemId, row._sum.quantity ?? 0]),
  );

  const lines = data.items.map((requested) => {
    const item = itemById.get(requested.saleItemId);
    if (!item) {
      throw new ValidationError("A returned line does not belong to this sale");
    }
    const before = returnedBefore.get(item.id) ?? 0;
    if (before + requested.quantity > item.quantity) {
      throw new OverReturnError();
    }
    return {
      requested,
      item,
      before,
      refundCents: valueOfUnits(item.lineTotalCents, item.quantity, before, requested.quantity),
    };
  });
  const refundCents = sumCents(lines.map((line) => line.refundCents));

  // Política: plazo y categorías sin devolución. Salirse necesita la autorización de un gerente.
  const policy = await evaluateReturnPolicy(tx, {
    saleCreatedAt: sale.createdAt,
    variantIds: lines.map((line) => line.item.variantId),
    now,
  });
  const outsidePolicy =
    policy.outsideWindow || lines.some((line) => policy.blockedVariantIds.has(line.item.variantId));
  const mayOverridePolicy =
    hasCapability(actor.role, "return.overridePolicy") ||
    (authorizer !== null && hasCapability(authorizer.role, "return.overridePolicy"));
  if (outsidePolicy && !mayOverridePolicy) {
    throw new ReturnPolicyError();
  }

  // Cómo se le devuelve el dinero
  let customerId: string | null = data.customerId ?? sale.customerId;
  if (data.refundMethod === "STORE_CREDIT") {
    if (!customerId) {
      throw new CustomerRequiredError();
    }
    const customer = await tx.customer.findFirst({
      where: { id: customerId, archivedAt: null },
      select: { id: true },
    });
    if (!customer) {
      throw new ValidationError("Unknown customer");
    }
  }
  const mayRefundCash =
    hasCapability(actor.role, "return.refundCash") ||
    (authorizer !== null && hasCapability(authorizer.role, "return.refundCash"));
  if (data.refundMethod === "CASH") {
    if (!mayRefundCash) {
      throw new ApprovalRequiredError();
    }
    const available = expectedCashCents(await loadCashTotals(tx, session.id));
    if (refundCents > available) {
      throw new InsufficientCashError();
    }
  }
  if (data.refundMethod === "ORIGINAL") {
    const payments = await tx.payment.findMany({
      where: { saleId: sale.id },
      select: { method: true },
    });
    // Solo se devuelve "al mismo método" lo pagado con tarjeta o transferencia; el efectivo sale del cajón.
    if (
      payments.some((payment) => payment.method === "CASH" || payment.method === "STORE_CREDIT")
    ) {
      throw new ValidationError("The original payment method cannot be refunded directly");
    }
  }
  if (data.refundMethod !== "STORE_CREDIT") {
    customerId = sale.customerId;
  }

  const refundMethod: RefundMethod = data.refundMethod;
  const number = await nextDocumentNumber(tx, "RETURN");
  const usedAuthorizer =
    authorizer !== null &&
    ((outsidePolicy && !hasCapability(actor.role, "return.overridePolicy")) ||
      (data.refundMethod === "CASH" && !hasCapability(actor.role, "return.refundCash")));

  const doc = await tx.returnDoc.create({
    data: {
      number,
      clientRequestId: data.clientRequestId,
      saleId: sale.id,
      customerId,
      type: "RETURN",
      reason: data.reason,
      refundMethod,
      refundCents,
      cashSessionId: session.id,
      processedById: actor.id,
      authorizedById: usedAuthorizer ? authorizer.id : null,
    },
    select: { id: true },
  });
  await tx.returnItem.createMany({
    data: lines.map((line) => ({
      returnId: doc.id,
      saleItemId: line.item.id,
      quantity: line.requested.quantity,
      condition: line.requested.condition,
      refundCents: line.refundCents,
      reason: line.requested.reason,
    })),
  });

  // Las prendas vuelven al inventario siempre en el mismo orden (por prenda): evita bloqueos cruzados.
  const ordered = [...lines].sort(
    (a, b) =>
      a.item.variantId.localeCompare(b.item.variantId) || a.item.id.localeCompare(b.item.id),
  );
  for (const line of ordered) {
    await recordMovement(tx, {
      variantId: line.item.variantId,
      locationId: sale.locationId,
      type: "RETURN_IN",
      quantity: line.requested.quantity,
      unitCostCents: line.item.unitCostCents,
      userId: actor.id,
      reason: `${RETURN_STOCK_REASON} ${number}`,
      refType: "ReturnDoc",
      refId: doc.id,
    });
    if (line.requested.condition === "DAMAGED") {
      await recordMovement(tx, {
        variantId: line.item.variantId,
        locationId: sale.locationId,
        type: "RETURN_SCRAP",
        quantity: -line.requested.quantity,
        unitCostCents: line.item.unitCostCents,
        userId: actor.id,
        reason: `${SCRAP_STOCK_REASON} ${number}`,
        refType: "ReturnDoc",
        refId: doc.id,
      });
    }
  }

  if (data.refundMethod === "STORE_CREDIT" && customerId) {
    await applyStoreCredit(tx, {
      customerId,
      amountCents: refundCents,
      reason: "RETURN",
      refType: "ReturnDoc",
      refId: doc.id,
      userId: actor.id,
    });
  }

  await audit.log(tx, {
    userId: actor.id,
    action: "RETURN_PROCESSED",
    entityType: "ReturnDoc",
    entityId: doc.id,
    after: {
      number,
      saleId: sale.id,
      refundCents,
      refundMethod,
      units: lines.reduce((sum, line) => sum + line.requested.quantity, 0),
    },
    reason: data.reason,
  });
  if (outsidePolicy || data.refundMethod === "CASH") {
    await audit.log(tx, {
      userId: actor.id,
      action: "RETURN_OVERRIDE",
      entityType: "ReturnDoc",
      entityId: doc.id,
      after: {
        outsidePolicy,
        cashRefund: data.refundMethod === "CASH",
        authorizedById: usedAuthorizer && authorizer ? authorizer.id : actor.id,
      },
      reason: data.reason,
    });
  }

  return { id: doc.id, number, refundCents, refundMethod, replayed: false };
}
