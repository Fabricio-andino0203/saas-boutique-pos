import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { LayawayStatus } from "@/generated/prisma/enums";
import { audit } from "@/lib/audit";
import { addLocalDays, endOfLocalDay } from "@/lib/dates";
import { db } from "@/lib/db";
import { nextDocumentNumber } from "@/lib/document-number";
import {
  CashSessionClosedError,
  ConflictError,
  LayawayDepositError,
  LayawayStateError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { percentOf } from "@/lib/money";
import { hasCapability, requireCapability } from "@/lib/permissions";
import { getSettings } from "@/lib/settings";
import { authorizeWithManagerPin } from "@/modules/auth/manager-override";
import type { SessionUser } from "@/modules/auth/service";
import type { Actor } from "@/modules/catalog/service";
import { getDefaultTerminal } from "@/modules/cash/service";
import { applyStoreCredit } from "@/modules/credit/service";
import {
  caiRangeIssuer,
  formatFiscalNumber,
  type FiscalDocumentIssuer,
} from "@/modules/fiscal/issuer";
import { recordMovement } from "@/modules/inventory/service";
import { priceCart, type CartLine } from "@/modules/sales/calc";
import { runSale } from "@/modules/sales/service";
import {
  addLayawayPaymentSchema,
  cancelLayawayInputSchema,
  createLayawayInputSchema,
  settleLayawayInputSchema,
} from "@/modules/layaways/schemas";

type Tx = Prisma.TransactionClient;

export const LAYAWAY_EXPIRED_REASON = "Venció el plazo del apartado";

export type CreatedLayaway = {
  id: string;
  number: string;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  expiresAt: Date;
  /** El recibo del abono inicial. */
  paymentId: string;
  replayed: boolean;
};

export type LayawayPaymentResult = {
  paymentId: string;
  paidCents: number;
  balanceCents: number;
  replayed: boolean;
};

export type SettledLayaway = {
  layawayNumber: string;
  sale: { id: string; number: string; totalCents: number; paidCents: number; changeCents: number };
  fiscalNumber: string | null;
  replayed: boolean;
};

function firstIssue(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "Invalid input";
}

/** Dos operaciones con el mismo identificador se atienden una tras otra: la segunda ya ve lo que hizo la primera. */
async function lockRequest(tx: Tx, key: string): Promise<void> {
  await tx.$queryRaw`
    SELECT 1 AS "locked" FROM (SELECT pg_advisory_xact_lock(hashtext(${key}))) AS "lock"
  `;
}

/** El turno abierto de la terminal, bloqueado en modo compartido (el cierre de caja espera a que termine esta operación). */
async function lockOpenSession(tx: Tx): Promise<string> {
  const terminal = await getDefaultTerminal(tx);
  const [session] = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "CashSession"
    WHERE "terminalId" = ${terminal.id} AND "status" = 'OPEN'
    FOR SHARE
  `;
  if (!session) {
    throw new CashSessionClosedError();
  }
  return session.id;
}

type LockedLayaway = {
  id: string;
  number: string;
  status: LayawayStatus;
  customerId: string;
  totalCents: number;
  paidCents: number;
  expiresAt: Date;
  saleId: string | null;
};

/** El apartado, con su fila bloqueada hasta que termine la transacción: abonos, saldado y cancelación se ordenan. */
async function lockLayaway(tx: Tx, layawayId: string): Promise<LockedLayaway> {
  const [layaway] = await tx.$queryRaw<LockedLayaway[]>`
    SELECT "id", "number", "status", "customerId", "totalCents", "paidCents", "expiresAt", "saleId"
    FROM "Layaway" WHERE "id" = ${layawayId} FOR UPDATE
  `;
  if (!layaway) {
    throw new NotFoundError("Layaway not found");
  }
  return layaway;
}

/** Cada prenda del apartado, siempre en el mismo orden: evita bloqueos cruzados con otras operaciones de stock. */
async function loadItems(tx: Tx, layawayId: string) {
  return tx.layawayItem.findMany({
    where: { layawayId },
    orderBy: [{ variantId: "asc" }, { id: "asc" }],
  });
}

// ───────────── Crear ─────────────

/**
 * Crea un apartado: reserva las prendas (sin tocar el inventario físico), guarda los precios de hoy y recibe el abono
 * inicial, que tiene que alcanzar el mínimo del ajuste `layaway.minDepositPercent`. Todo o nada: si una prenda no
 * alcanza o falta la caja abierta, no queda nada. Idempotente por `clientRequestId`.
 */
export async function createLayaway(
  actor: Actor,
  input: unknown,
  client: PrismaClient = db,
  now: Date = new Date(),
): Promise<CreatedLayaway> {
  requireCapability(actor, "layaway.manage");
  const parsed = createLayawayInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(firstIssue(parsed.error));
  }
  const data = parsed.data;

  return client.$transaction(
    async (tx) => {
      await lockRequest(tx, `layaway:${data.clientRequestId}`);
      const existing = await tx.layaway.findUnique({
        where: { clientRequestId: data.clientRequestId },
        select: {
          id: true,
          number: true,
          totalCents: true,
          paidCents: true,
          expiresAt: true,
          createdById: true,
        },
      });
      if (existing) {
        if (existing.createdById !== actor.id) {
          throw new ConflictError();
        }
        const first = await tx.layawayPayment.findFirst({
          where: { layawayId: existing.id },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        });
        return {
          id: existing.id,
          number: existing.number,
          totalCents: existing.totalCents,
          paidCents: existing.paidCents,
          balanceCents: existing.totalCents - existing.paidCents,
          expiresAt: existing.expiresAt,
          paymentId: first?.id ?? "",
          replayed: true,
        };
      }

      const sessionId = await lockOpenSession(tx);
      const settings = await getSettings(tx);

      const customer = await tx.customer.findFirst({
        where: { id: data.customerId, archivedAt: null },
        select: { id: true },
      });
      if (!customer) {
        throw new ValidationError("Unknown customer");
      }

      // Una prenda repetida se junta en una sola línea.
      const quantities = new Map<string, number>();
      for (const line of data.lines) {
        quantities.set(line.variantId, (quantities.get(line.variantId) ?? 0) + line.quantity);
      }
      const variantIds = [...quantities.keys()].sort();
      // Las relaciones se cargan en fila: un `include` las lanzaría a la vez sobre la misma conexión de la transacción.
      const variants = await tx.variant.findMany({ where: { id: { in: variantIds } } });
      const products = await tx.product.findMany({
        where: { id: { in: [...new Set(variants.map((variant) => variant.productId))] } },
      });
      const sizes = await tx.size.findMany({
        where: {
          id: { in: variants.flatMap((variant) => (variant.sizeId ? [variant.sizeId] : [])) },
        },
      });
      const colors = await tx.color.findMany({
        where: {
          id: { in: variants.flatMap((variant) => (variant.colorId ? [variant.colorId] : [])) },
        },
      });
      const productById = new Map(products.map((product) => [product.id, product]));
      const sizeById = new Map(sizes.map((size) => [size.id, size]));
      const colorById = new Map(colors.map((color) => [color.id, color]));
      const items = variantIds.map((variantId) => {
        const variant = variants.find((candidate) => candidate.id === variantId);
        const product = variant ? productById.get(variant.productId) : undefined;
        if (!variant || !product || variant.archivedAt !== null || product.archivedAt !== null) {
          throw new NotFoundError("Variant not available");
        }
        return {
          variant,
          product,
          size: variant.sizeId ? (sizeById.get(variant.sizeId) ?? null) : null,
          color: variant.colorId ? (colorById.get(variant.colorId) ?? null) : null,
          quantity: quantities.get(variantId) ?? 0,
          unitPriceCents: variant.priceCents ?? product.basePriceCents,
        };
      });

      const cart: CartLine[] = items.map((item) => ({
        unitPriceCents: item.unitPriceCents,
        quantity: item.quantity,
        taxRateBps: item.product.taxCategory === "EXEMPT" ? 0 : settings["tax.rate"],
      }));
      const priced = priceCart(cart, { pricesIncludeTax: settings["tax.pricesIncludeTax"] });
      if (priced.totalCents <= 0) {
        throw new ValidationError("A layaway must have a total above zero");
      }

      // El abono inicial: al menos el mínimo y no más que el total.
      const minDeposit = percentOf(priced.totalCents, settings["layaway.minDepositPercent"] * 100);
      if (data.deposit.amountCents < minDeposit) {
        throw new LayawayDepositError();
      }
      if (data.deposit.amountCents > priced.totalCents) {
        throw new ValidationError("The deposit cannot be more than the total");
      }

      const number = await nextDocumentNumber(tx, "LAYAWAY");
      const expiresAt = endOfLocalDay(addLocalDays(now, settings["layaway.expiryDays"]));
      const layaway = await tx.layaway.create({
        data: {
          number,
          clientRequestId: data.clientRequestId,
          customerId: data.customerId,
          totalCents: priced.totalCents,
          paidCents: data.deposit.amountCents,
          expiresAt,
          createdById: actor.id,
        },
        select: { id: true },
      });
      // Ítems y abono en inserciones separadas y en fila (una sola conexión por transacción).
      await tx.layawayItem.createMany({
        data: items.map((item) => ({
          layawayId: layaway.id,
          variantId: item.variant.id,
          quantity: item.quantity,
          unitPriceCents: item.unitPriceCents,
          productName: item.product.name,
          sizeName: item.size?.name ?? null,
          colorName: item.color?.name ?? null,
          sku: item.variant.sku,
        })),
      });
      const payment = await tx.layawayPayment.create({
        data: {
          layawayId: layaway.id,
          method: data.deposit.method,
          amountCents: data.deposit.amountCents,
          reference: data.deposit.reference,
          cashSessionId: sessionId,
          userId: actor.id,
        },
        select: { id: true },
      });

      // Reservar: lo apartado deja de estar disponible, pero sigue en la tienda (onHand no cambia).
      const locationId = (await getDefaultTerminal(tx)).locationId;
      for (const item of items) {
        await recordMovement(tx, {
          variantId: item.variant.id,
          locationId,
          type: "LAYAWAY_RESERVE",
          quantity: item.quantity,
          userId: actor.id,
          refType: "Layaway",
          refId: layaway.id,
        });
      }

      return {
        id: layaway.id,
        number,
        totalCents: priced.totalCents,
        paidCents: data.deposit.amountCents,
        balanceCents: priced.totalCents - data.deposit.amountCents,
        expiresAt,
        paymentId: payment.id,
        replayed: false,
      };
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
}

// ───────────── Abonar ─────────────

/** Recibe un abono (con su recibo). No puede pasar del saldo; el apartado debe seguir activo y sin vencer. */
export async function addLayawayPayment(
  actor: Actor,
  input: unknown,
  client: PrismaClient = db,
  now: Date = new Date(),
): Promise<LayawayPaymentResult> {
  requireCapability(actor, "layaway.manage");
  const parsed = addLayawayPaymentSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(firstIssue(parsed.error));
  }
  const data = parsed.data;

  return client.$transaction(
    async (tx) => {
      const layaway = await lockLayaway(tx, data.layawayId);
      const replay = await tx.layawayPayment.findUnique({
        where: { clientRequestId: data.clientRequestId },
        select: { id: true, layawayId: true, userId: true },
      });
      if (replay) {
        if (replay.layawayId !== layaway.id || replay.userId !== actor.id) {
          throw new ConflictError();
        }
        return {
          paymentId: replay.id,
          paidCents: layaway.paidCents,
          balanceCents: layaway.totalCents - layaway.paidCents,
          replayed: true,
        };
      }
      if (layaway.status !== "ACTIVE" || layaway.expiresAt.getTime() < now.getTime()) {
        throw new LayawayStateError();
      }
      const balance = layaway.totalCents - layaway.paidCents;
      if (data.payment.amountCents > balance) {
        throw new ValidationError("The payment is more than the balance of the layaway");
      }

      const sessionId = await lockOpenSession(tx);
      const payment = await tx.layawayPayment.create({
        data: {
          layawayId: layaway.id,
          method: data.payment.method,
          amountCents: data.payment.amountCents,
          reference: data.payment.reference,
          clientRequestId: data.clientRequestId,
          cashSessionId: sessionId,
          userId: actor.id,
        },
        select: { id: true },
      });
      const paidCents = layaway.paidCents + data.payment.amountCents;
      await tx.layaway.update({ where: { id: layaway.id }, data: { paidCents } });
      return {
        paymentId: payment.id,
        paidCents,
        balanceCents: layaway.totalCents - paidCents,
        replayed: false,
      };
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
}

// ───────────── Saldar ─────────────

/**
 * Salda el apartado: libera la reserva y lo convierte en una venta a los precios de cuando se apartó. Los abonos ya
 * recibidos pagan la venta como un pago "Abonos del apartado" (su efectivo ya entró en el turno en que se recibió) y
 * lo que falta se cobra con los pagos de siempre. Todo o nada; idempotente por `clientRequestId`.
 */
export async function settleLayaway(
  actor: Actor,
  input: unknown,
  client: PrismaClient = db,
  issuer: FiscalDocumentIssuer = caiRangeIssuer,
  now: Date = new Date(),
): Promise<SettledLayaway> {
  requireCapability(actor, "layaway.manage");
  requireCapability(actor, "sale.create");
  const parsed = settleLayawayInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(firstIssue(parsed.error));
  }
  const data = parsed.data;

  return client.$transaction(
    async (tx) => {
      const layaway = await lockLayaway(tx, data.layawayId);
      if (layaway.status === "COMPLETED" && layaway.saleId) {
        const sale = await tx.sale.findUnique({
          where: { id: layaway.saleId },
          select: {
            id: true,
            number: true,
            totalCents: true,
            paidCents: true,
            changeCents: true,
            clientRequestId: true,
            sellerId: true,
            fiscalNumber: true,
            fiscalRange: { select: { prefix: true } },
          },
        });
        if (sale && sale.clientRequestId === data.clientRequestId && sale.sellerId === actor.id) {
          return {
            layawayNumber: layaway.number,
            sale: {
              id: sale.id,
              number: sale.number,
              totalCents: sale.totalCents,
              paidCents: sale.paidCents,
              changeCents: sale.changeCents,
            },
            fiscalNumber:
              sale.fiscalNumber !== null && sale.fiscalRange
                ? formatFiscalNumber(sale.fiscalRange.prefix, sale.fiscalNumber)
                : null,
            replayed: true,
          };
        }
      }
      if (layaway.status !== "ACTIVE" || layaway.expiresAt.getTime() < now.getTime()) {
        throw new LayawayStateError();
      }

      const items = await loadItems(tx, layaway.id);
      const locationId = (await getDefaultTerminal(tx)).locationId;
      // Primero se libera la reserva (queda disponible) y luego la venta saca las prendas.
      for (const item of items) {
        await recordMovement(tx, {
          variantId: item.variantId,
          locationId,
          type: "LAYAWAY_RELEASE",
          quantity: -item.quantity,
          userId: actor.id,
          refType: "Layaway",
          refId: layaway.id,
        });
      }

      const sale = await runSale(
        tx,
        actor,
        {
          clientRequestId: data.clientRequestId,
          lines: items.map((item) => ({ variantId: item.variantId, quantity: item.quantity })),
          payments: data.payments,
          customerId: layaway.customerId,
          ...(data.invoice ? { invoice: data.invoice } : {}),
        },
        null,
        issuer,
        {
          layawayCents: layaway.paidCents,
          unitPrices: new Map(items.map((item) => [item.variantId, item.unitPriceCents])),
        },
      );
      if (sale.totalCents !== layaway.totalCents) {
        // Los impuestos cambiaron desde que se apartó: no se cobra distinto de lo pactado.
        throw new ValidationError(
          "The total of the layaway changed: cancel it and create it again",
        );
      }

      await tx.layaway.update({
        where: { id: layaway.id },
        data: { status: "COMPLETED", saleId: sale.id },
      });
      return {
        layawayNumber: layaway.number,
        sale: {
          id: sale.id,
          number: sale.number,
          totalCents: sale.totalCents,
          paidCents: sale.paidCents,
          changeCents: sale.changeCents,
        },
        fiscalNumber: sale.fiscalNumber,
        replayed: false,
      };
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
}

// ───────────── Cancelar y vencer ─────────────

type CloseOptions = {
  status: "CANCELLED" | "EXPIRED";
  reason: string;
  /** Lo que la tienda se queda; el resto de lo abonado pasa a crédito de tienda. */
  retainCents: number;
  /** Quien hace la operación en el sistema (movimientos y libro). */
  actorId: string;
  /** Quien responde por ella: el gerente que autorizó con su PIN, si lo hubo. */
  responsibleId: string;
  now: Date;
};

/** Cierra un apartado activo: libera la reserva, devuelve lo abonado como crédito de tienda y lo deja auditado. */
async function closeLayaway(tx: Tx, layawayId: string, options: CloseOptions): Promise<void> {
  const layaway = await lockLayaway(tx, layawayId);
  if (layaway.status !== "ACTIVE") {
    throw new LayawayStateError();
  }
  if (options.retainCents > layaway.paidCents) {
    throw new ValidationError("The store cannot keep more than what was paid");
  }

  const items = await loadItems(tx, layaway.id);
  const locationId = (await getDefaultTerminal(tx)).locationId;
  for (const item of items) {
    await recordMovement(tx, {
      variantId: item.variantId,
      locationId,
      type: "LAYAWAY_RELEASE",
      quantity: -item.quantity,
      userId: options.actorId,
      reason: options.reason,
      refType: "Layaway",
      refId: layaway.id,
    });
  }
  const creditCents = layaway.paidCents - options.retainCents;
  if (creditCents > 0) {
    await applyStoreCredit(tx, {
      customerId: layaway.customerId,
      amountCents: creditCents,
      reason: "LAYAWAY_CANCEL",
      refType: "Layaway",
      refId: layaway.id,
      userId: options.actorId,
      note: `${layaway.number}: ${options.reason}`,
    });
  }
  await tx.layaway.update({
    where: { id: layaway.id },
    data: {
      status: options.status,
      retainedCents: options.retainCents,
      cancelledAt: options.now,
      cancelReason: options.reason,
      cancelledById: options.responsibleId,
    },
  });
  await audit.log(tx, {
    userId: options.actorId,
    action: "LAYAWAY_CANCELLED",
    entityType: "Layaway",
    entityId: layaway.id,
    before: { status: "ACTIVE", paidCents: layaway.paidCents },
    after: {
      status: options.status,
      number: layaway.number,
      creditedCents: creditCents,
      retainedCents: options.retainCents,
      ...(options.responsibleId !== options.actorId
        ? { authorizedById: options.responsibleId }
        : {}),
    },
    reason: options.reason,
  });
}

/**
 * Cancela un apartado: las prendas vuelven a estar disponibles y lo abonado pasa a crédito de tienda (menos lo que la
 * tienda decida retener). Lo hace un gerente o, con su PIN, un cajero.
 */
export async function cancelLayaway(
  actor: Actor,
  input: unknown,
  client: PrismaClient = db,
  now: Date = new Date(),
): Promise<{ id: string }> {
  requireCapability(actor, "layaway.manage");
  const parsed = cancelLayawayInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(firstIssue(parsed.error));
  }
  const data = parsed.data;

  // El PIN se verifica fuera de la transacción: un PIN malo cuenta como intento fallido aunque esta se revierta.
  let authorizer: SessionUser | null = null;
  if (!hasCapability(actor.role, "layaway.cancel")) {
    if (!data.managerOverride) {
      requireCapability(actor, "layaway.cancel");
    } else {
      authorizer = await authorizeWithManagerPin("layaway.cancel", data.managerOverride, client);
    }
  }

  await client.$transaction(
    (tx) =>
      closeLayaway(tx, data.layawayId, {
        status: "CANCELLED",
        reason: data.reason,
        retainCents: data.retainCents ?? 0,
        actorId: actor.id,
        responsibleId: authorizer?.id ?? actor.id,
        now,
      }),
    { timeout: 30_000, maxWait: 10_000 },
  );
  return { id: data.layawayId };
}

/**
 * Vence los apartados cuyo plazo ya pasó: cada uno en su propia transacción (uno que falle no frena a los demás).
 * Se llama de forma oportunista al abrir la lista de apartados o la pantalla de venta, y a diario desde la tarea
 * programada (`expireAllOverdueLayaways`). Devuelve cuántos venció.
 */
export async function expireOverdueLayaways(
  actor: Actor,
  client: PrismaClient = db,
  now: Date = new Date(),
): Promise<number> {
  requireCapability(actor, "layaway.manage");
  const overdue = await client.layaway.findMany({
    where: { status: "ACTIVE", expiresAt: { lt: now } },
    select: { id: true },
    orderBy: { expiresAt: "asc" },
    take: 50,
  });
  let expired = 0;
  for (const { id } of overdue) {
    try {
      await client.$transaction(
        (tx) =>
          closeLayaway(tx, id, {
            status: "EXPIRED",
            reason: LAYAWAY_EXPIRED_REASON,
            retainCents: 0,
            actorId: actor.id,
            responsibleId: actor.id,
            now,
          }),
        { timeout: 30_000, maxWait: 10_000 },
      );
      expired += 1;
    } catch (error) {
      // Otra caja lo cerró o lo saldó justo antes: ya no hay nada que vencer.
      if (!(error instanceof LayawayStateError)) {
        throw error;
      }
    }
  }
  return expired;
}

const EXPIRY_BATCHES_MAX = 100;

/**
 * La tarea programada (`pnpm job:expire-layaways`, pensada para el cron del servidor): vence todo lo que ya pasó de plazo,
 * por lotes, actuando como el propietario activo más antiguo (las filas quedan con su nombre y el motivo "Venció el plazo
 * del apartado"). Devuelve cuántos venció en total.
 */
export async function expireAllOverdueLayaways(
  client: PrismaClient = db,
  now: Date = new Date(),
): Promise<number> {
  const owner = await client.user.findFirst({
    where: { role: "OWNER", isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!owner) {
    throw new NotFoundError("There is no active owner to run the scheduled job as");
  }
  let total = 0;
  for (let batch = 0; batch < EXPIRY_BATCHES_MAX; batch += 1) {
    const expired = await expireOverdueLayaways({ id: owner.id, role: "OWNER" }, client, now);
    if (expired === 0) {
      break;
    }
    total += expired;
  }
  return total;
}
