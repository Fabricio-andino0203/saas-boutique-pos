import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { RefundMethod, ReturnType } from "@/generated/prisma/enums";
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
import { caiRangeIssuer, type FiscalDocumentIssuer } from "@/modules/fiscal/issuer";
import { recordMovement } from "@/modules/inventory/service";
import { valueOfUnits } from "@/modules/returns/calc";
import { evaluateReturnPolicy } from "@/modules/returns/policy";
import {
  exchangeInputSchema,
  returnInputSchema,
  type ExchangeData,
  type RefundChoice,
  type ReturnData,
} from "@/modules/returns/schemas";
import { runSale } from "@/modules/sales/service";

type Tx = Prisma.TransactionClient;

/** La venta nueva de un cambio, tal como la necesita la pantalla. */
export type ExchangeSale = {
  id: string;
  number: string;
  totalCents: number;
  paidCents: number;
  changeCents: number;
  /** Lo que se pagó con el valor de lo devuelto. */
  creditAppliedCents: number;
  fiscalNumber: string | null;
};

export type ProcessedReturn = {
  id: string;
  /** Número del comprobante (`DV-000012`). */
  number: string;
  /** El dinero que se le devuelve al cliente (en un cambio, solo lo que sobra). */
  refundCents: number;
  refundMethod: RefundMethod;
  /** Solo en un cambio: la venta nueva. */
  exchange: ExchangeSale | null;
  /** `true` si ya estaba registrada con ese `clientRequestId` y no se hizo nada nuevo. */
  replayed: boolean;
};

export const RETURN_STOCK_REASON = "Devolución";
export const SCRAP_STOCK_REASON = "Merma por devolución";

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

async function findReplay(
  client: Pick<PrismaClient, "returnDoc" | "payment">,
  clientRequestId: string,
  actorId: string,
): Promise<ProcessedReturn | null> {
  const doc = await client.returnDoc.findUnique({
    where: { clientRequestId },
    select: {
      id: true,
      number: true,
      refundCents: true,
      refundMethod: true,
      processedById: true,
      exchangeSale: {
        select: {
          id: true,
          number: true,
          totalCents: true,
          paidCents: true,
          changeCents: true,
          fiscalNumber: true,
          fiscalRange: { select: { prefix: true } },
        },
      },
    },
  });
  if (!doc) {
    return null;
  }
  if (doc.processedById !== actorId) {
    throw new ConflictError();
  }
  let exchange: ExchangeSale | null = null;
  if (doc.exchangeSale) {
    const credit = await client.payment.findFirst({
      where: { saleId: doc.exchangeSale.id, method: "EXCHANGE" },
      select: { amountCents: true },
    });
    const { fiscalRange, fiscalNumber, ...sale } = doc.exchangeSale;
    exchange = {
      ...sale,
      creditAppliedCents: credit?.amountCents ?? 0,
      fiscalNumber:
        fiscalNumber !== null && fiscalRange
          ? `${fiscalRange.prefix}${String(fiscalNumber).padStart(8, "0")}`
          : null,
    };
  }
  return {
    id: doc.id,
    number: doc.number,
    refundCents: doc.refundCents,
    refundMethod: doc.refundMethod,
    exchange,
    replayed: true,
  };
}

/** Lo que se necesita saber de una devolución ya validada, para reembolsarla o aplicarla a un cambio. */
type ReturnContext = {
  sale: { id: string; createdAt: Date; customerId: string | null; locationId: string };
  session: { id: string };
  lines: {
    requested: ReturnData["items"][number];
    item: {
      id: string;
      variantId: string;
      quantity: number;
      unitCostCents: number;
      lineTotalCents: number;
    };
    before: number;
    refundCents: number;
  }[];
  /** Lo que pagó el cliente por las prendas que vuelven (prorrateo exacto). */
  valueCents: number;
  outsidePolicy: boolean;
  authorizer: SessionUser | null;
};

/**
 * Bloquea la venta y el turno, comprueba lo que se quiere devolver (cantidades, política y quién puede autorizar) y
 * calcula lo que vale. Debe llamarse dentro de la transacción, antes de tocar nada.
 */
async function loadReturnContext(
  tx: Tx,
  actor: Actor,
  data: { saleId: string; items: ReturnData["items"] },
  authorizer: SessionUser | null,
  now: Date,
): Promise<ReturnContext> {
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

  return {
    sale: {
      id: sale.id,
      createdAt: sale.createdAt,
      customerId: sale.customerId,
      locationId: sale.locationId,
    },
    session,
    lines,
    valueCents: sumCents(lines.map((line) => line.refundCents)),
    outsidePolicy,
    authorizer,
  };
}

/**
 * Comprueba que el dinero se pueda devolver como se pidió y dice a qué cliente se acredita: el crédito de tienda
 * necesita un cliente; el efectivo, la autorización de un gerente y que haya en el cajón; "mismo método", que se
 * haya pagado con tarjeta o transferencia.
 */
async function settleRefund(
  tx: Tx,
  actor: Actor,
  ctx: ReturnContext,
  refund: { method: RefundChoice | "NONE"; customerId?: string; cents: number },
): Promise<{ customerId: string | null; usedAuthorizer: boolean }> {
  let customerId: string | null = refund.customerId ?? ctx.sale.customerId;
  const authorizer = ctx.authorizer;
  let usedAuthorizer =
    authorizer !== null && ctx.outsidePolicy && !hasCapability(actor.role, "return.overridePolicy");

  if (refund.method === "STORE_CREDIT") {
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
  if (refund.method === "CASH") {
    const mayRefundCash =
      hasCapability(actor.role, "return.refundCash") ||
      (authorizer !== null && hasCapability(authorizer.role, "return.refundCash"));
    if (!mayRefundCash) {
      throw new ApprovalRequiredError();
    }
    if (!hasCapability(actor.role, "return.refundCash")) {
      usedAuthorizer = authorizer !== null;
    }
    const available = expectedCashCents(await loadCashTotals(tx, ctx.session.id));
    if (refund.cents > available) {
      throw new InsufficientCashError();
    }
  }
  if (refund.method === "ORIGINAL") {
    const payments = await tx.payment.findMany({
      where: { saleId: ctx.sale.id },
      select: { method: true },
    });
    // Solo se devuelve "al mismo método" lo pagado con tarjeta o transferencia; el efectivo sale del cajón.
    if (
      payments.some((payment) => payment.method === "CASH" || payment.method === "STORE_CREDIT")
    ) {
      throw new ValidationError("The original payment method cannot be refunded directly");
    }
  }
  if (refund.method !== "STORE_CREDIT") {
    customerId = refund.customerId ?? ctx.sale.customerId;
  }
  return { customerId, usedAuthorizer };
}

/** Escribe el comprobante, devuelve las prendas al inventario (o a merma), acredita y audita. */
async function persistReturn(
  tx: Tx,
  actor: Actor,
  ctx: ReturnContext,
  doc: {
    number: string;
    clientRequestId: string;
    type: ReturnType;
    reason: string;
    refundMethod: RefundMethod;
    refundCents: number;
    customerId: string | null;
    usedAuthorizer: boolean;
    exchangeSaleId?: string;
  },
): Promise<string> {
  const created = await tx.returnDoc.create({
    data: {
      number: doc.number,
      clientRequestId: doc.clientRequestId,
      saleId: ctx.sale.id,
      customerId: doc.customerId,
      type: doc.type,
      exchangeSaleId: doc.exchangeSaleId,
      reason: doc.reason,
      refundMethod: doc.refundMethod,
      refundCents: doc.refundCents,
      cashSessionId: ctx.session.id,
      processedById: actor.id,
      authorizedById: doc.usedAuthorizer && ctx.authorizer ? ctx.authorizer.id : null,
    },
    select: { id: true },
  });
  await tx.returnItem.createMany({
    data: ctx.lines.map((line) => ({
      returnId: created.id,
      saleItemId: line.item.id,
      quantity: line.requested.quantity,
      condition: line.requested.condition,
      refundCents: line.refundCents,
      reason: line.requested.reason,
    })),
  });

  // Las prendas vuelven al inventario siempre en el mismo orden (por prenda): evita bloqueos cruzados.
  const ordered = [...ctx.lines].sort(
    (a, b) =>
      a.item.variantId.localeCompare(b.item.variantId) || a.item.id.localeCompare(b.item.id),
  );
  for (const line of ordered) {
    await recordMovement(tx, {
      variantId: line.item.variantId,
      locationId: ctx.sale.locationId,
      type: "RETURN_IN",
      quantity: line.requested.quantity,
      unitCostCents: line.item.unitCostCents,
      userId: actor.id,
      reason: `${RETURN_STOCK_REASON} ${doc.number}`,
      refType: "ReturnDoc",
      refId: created.id,
    });
    if (line.requested.condition === "DAMAGED") {
      await recordMovement(tx, {
        variantId: line.item.variantId,
        locationId: ctx.sale.locationId,
        type: "RETURN_SCRAP",
        quantity: -line.requested.quantity,
        unitCostCents: line.item.unitCostCents,
        userId: actor.id,
        reason: `${SCRAP_STOCK_REASON} ${doc.number}`,
        refType: "ReturnDoc",
        refId: created.id,
      });
    }
  }

  if (doc.refundMethod === "STORE_CREDIT" && doc.customerId && doc.refundCents > 0) {
    await applyStoreCredit(tx, {
      customerId: doc.customerId,
      amountCents: doc.refundCents,
      reason: "RETURN",
      refType: "ReturnDoc",
      refId: created.id,
      userId: actor.id,
    });
  }

  await audit.log(tx, {
    userId: actor.id,
    action: "RETURN_PROCESSED",
    entityType: "ReturnDoc",
    entityId: created.id,
    after: {
      number: doc.number,
      saleId: ctx.sale.id,
      type: doc.type,
      valueCents: ctx.valueCents,
      refundCents: doc.refundCents,
      refundMethod: doc.refundMethod,
      units: ctx.lines.reduce((sum, line) => sum + line.requested.quantity, 0),
      ...(doc.exchangeSaleId ? { exchangeSaleId: doc.exchangeSaleId } : {}),
    },
    reason: doc.reason,
  });
  if (ctx.outsidePolicy || doc.refundMethod === "CASH") {
    await audit.log(tx, {
      userId: actor.id,
      action: "RETURN_OVERRIDE",
      entityType: "ReturnDoc",
      entityId: created.id,
      after: {
        outsidePolicy: ctx.outsidePolicy,
        cashRefund: doc.refundMethod === "CASH",
        authorizedById: doc.usedAuthorizer && ctx.authorizer ? ctx.authorizer.id : actor.id,
      },
      reason: doc.reason,
    });
  }
  return created.id;
}

/** Dos envíos con el mismo identificador se atienden uno tras otro: el segundo ya ve la devolución del primero. */
async function lockRequest(tx: Tx, clientRequestId: string): Promise<void> {
  await tx.$queryRaw`
    SELECT 1 AS "locked" FROM (SELECT pg_advisory_xact_lock(hashtext(${`return:${clientRequestId}`}))) AS "lock"
  `;
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
    return await client.$transaction(
      async (tx) => {
        await lockRequest(tx, data.clientRequestId);
        const replay = await findReplay(tx, data.clientRequestId, actor.id);
        if (replay) {
          return replay;
        }
        const ctx = await loadReturnContext(tx, actor, data, authorizer, now);
        const settled = await settleRefund(tx, actor, ctx, {
          method: data.refundMethod,
          customerId: data.customerId,
          cents: ctx.valueCents,
        });
        const number = await nextDocumentNumber(tx, "RETURN");
        const id = await persistReturn(tx, actor, ctx, {
          number,
          clientRequestId: data.clientRequestId,
          type: "RETURN",
          reason: data.reason,
          refundMethod: data.refundMethod,
          refundCents: ctx.valueCents,
          customerId: settled.customerId,
          usedAuthorizer: settled.usedAuthorizer,
        });
        return {
          id,
          number,
          refundCents: ctx.valueCents,
          refundMethod: data.refundMethod,
          exchange: null,
          replayed: false,
        };
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
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

/**
 * Cambio: el cliente devuelve prendas y se lleva otras en una sola operación. El valor de lo devuelto (prorrateo exacto)
 * se aplica a la venta nueva como un pago "Cambio"; si lo nuevo vale más, el cliente paga la diferencia con los pagos
 * normales; si vale menos, lo que sobra se le devuelve como en una devolución (crédito de tienda por defecto, efectivo
 * con la autorización de un gerente). Todo o nada: si falta stock de lo nuevo, la devolución tampoco se registra.
 */
export async function processExchange(
  actor: Actor,
  input: unknown,
  client: PrismaClient = db,
  now: Date = new Date(),
  issuer: FiscalDocumentIssuer = caiRangeIssuer,
): Promise<ProcessedReturn> {
  requireCapability(actor, "return.create");
  requireCapability(actor, "sale.create");
  const parsed = exchangeInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const data: ExchangeData = parsed.data;

  const existing = await findReplay(client, data.clientRequestId, actor.id);
  if (existing) {
    return existing;
  }

  const authorizer: SessionUser | null = data.managerOverride
    ? await authorizeWithManagerPin("return.overridePolicy", data.managerOverride, client)
    : null;

  try {
    return await client.$transaction(
      async (tx) => {
        await lockRequest(tx, data.clientRequestId);
        const replay = await findReplay(tx, data.clientRequestId, actor.id);
        if (replay) {
          return replay;
        }
        const ctx = await loadReturnContext(tx, actor, data, authorizer, now);

        // Siempre el mismo orden de bloqueos: contador de devoluciones → (en la venta) rango fiscal, contador de
        // tickets y existencias.
        const number = await nextDocumentNumber(tx, "RETURN");
        const customerId = data.customerId ?? ctx.sale.customerId ?? undefined;
        const sale = await runSale(
          tx,
          actor,
          {
            clientRequestId: `${data.clientRequestId}:sale`,
            lines: data.newLines,
            discount: data.discount,
            payments: data.payments,
            customerId,
            invoice: data.invoice,
          },
          // El PIN del gerente también vale para un descuento sobre el límite en lo que se lleva.
          authorizer && hasCapability(authorizer.role, "discount.applyBeyondLimit")
            ? authorizer
            : null,
          issuer,
          { creditCents: ctx.valueCents },
        );

        // Lo que sobra del valor devuelto vuelve al cliente como cualquier devolución
        const leftoverCents = ctx.valueCents - sale.creditAppliedCents;
        const refundMethod: RefundMethod =
          leftoverCents > 0 ? (data.refundMethod ?? "STORE_CREDIT") : "NONE";
        const settled = await settleRefund(tx, actor, ctx, {
          method: refundMethod,
          customerId: data.customerId,
          cents: leftoverCents,
        });
        const id = await persistReturn(tx, actor, ctx, {
          number,
          clientRequestId: data.clientRequestId,
          type: "EXCHANGE",
          reason: data.reason,
          refundMethod,
          refundCents: leftoverCents,
          customerId: settled.customerId,
          usedAuthorizer: settled.usedAuthorizer,
          exchangeSaleId: sale.id,
        });
        return {
          id,
          number,
          refundCents: leftoverCents,
          refundMethod,
          exchange: {
            id: sale.id,
            number: sale.number,
            totalCents: sale.totalCents,
            paidCents: sale.paidCents,
            changeCents: sale.changeCents,
            creditAppliedCents: sale.creditAppliedCents,
            fiscalNumber: sale.fiscalNumber,
          },
          replayed: false,
        };
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
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
