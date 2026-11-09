import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { PaymentMethod } from "@/generated/prisma/enums";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import {
  CashSessionClosedError,
  ConflictError,
  CustomerRequiredError,
  DiscountNeedsApprovalError,
  ForbiddenError,
  NotFoundError,
  SaleStateError,
  ValidationError,
} from "@/lib/errors";
import { nextDocumentNumber } from "@/lib/document-number";
import { mulCents, sumCents } from "@/lib/money";
import { hasCapability, requireCapability } from "@/lib/permissions";
import { getSettings } from "@/lib/settings";
import { authorizeWithManagerPin } from "@/modules/auth/manager-override";
import { applyStoreCredit } from "@/modules/credit/service";
import type { SessionUser } from "@/modules/auth/service";
import type { Actor } from "@/modules/catalog/service";
import { getDefaultTerminal } from "@/modules/cash/service";
import {
  caiRangeIssuer,
  formatFiscalNumber,
  type FiscalDocumentIssuer,
  type IssuedFiscalDocument,
} from "@/modules/fiscal/issuer";
import { recordMovement } from "@/modules/inventory/service";
import {
  discountExceedsLimit,
  priceCart,
  settlePayments,
  type CartLine,
} from "@/modules/sales/calc";
import {
  cancelTicketSchema,
  saleInputSchema,
  voidSaleSchema,
  type SaleData,
} from "@/modules/sales/schemas";

type Tx = Prisma.TransactionClient;

export type CompletedSale = {
  id: string;
  /** Número interno del ticket (`T-000042`). */
  number: string;
  totalCents: number;
  paidCents: number;
  changeCents: number;
  /** Número de factura con CAI, si se emitió. */
  fiscalNumber: string | null;
  /** Lo que se pagó con el crédito de una devolución (solo en un cambio). */
  creditAppliedCents: number;
  /** `true` si el cobro ya se había registrado con ese `clientRequestId` y no se hizo nada nuevo. */
  replayed: boolean;
};

export const DISCOUNT_OVERRIDE_REASON = "Descuento sobre el límite autorizado con PIN";
export const VOID_STOCK_REASON = "Anulación de venta";

function firstIssue(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "Invalid input";
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

/** El cobro ya hecho con ese identificador, para devolver lo mismo si el cliente reintenta. */
async function findReplay(
  client: Pick<PrismaClient, "sale">,
  clientRequestId: string,
  sellerId: string,
): Promise<CompletedSale | null> {
  const sale = await client.sale.findUnique({
    where: { clientRequestId },
    select: {
      id: true,
      number: true,
      totalCents: true,
      paidCents: true,
      changeCents: true,
      sellerId: true,
      fiscalNumber: true,
      fiscalRange: { select: { prefix: true } },
    },
  });
  if (!sale) {
    return null;
  }
  if (sale.sellerId !== sellerId) {
    // El identificador es de otra persona: no se le devuelve su venta a quien no la hizo.
    throw new ConflictError();
  }
  return {
    id: sale.id,
    number: sale.number,
    totalCents: sale.totalCents,
    paidCents: sale.paidCents,
    changeCents: sale.changeCents,
    fiscalNumber:
      sale.fiscalNumber !== null && sale.fiscalRange
        ? formatFiscalNumber(sale.fiscalRange.prefix, sale.fiscalNumber)
        : null,
    creditAppliedCents: 0,
    replayed: true,
  };
}

/**
 * Cobra una venta. El carrito llega del cliente solo como intención (qué prendas, cuántas, qué descuento);
 * el servidor busca los precios, recalcula todo y hace todo-o-nada en una transacción: número correlativo,
 * factura con CAI si se pidió, la venta con sus líneas (copia de precio, costo, descuento e ISV), los pagos
 * y la salida de stock por cada prenda.
 *
 * - Idempotente por `clientRequestId`: reintentar (doble clic, red caída) devuelve la misma venta.
 * - Si dos cajas venden la última prenda a la vez, una gana y la otra recibe `InsufficientStockError`.
 * - Sin caja abierta en la terminal no se vende.
 * - Un descuento sobre el límite del cajero necesita el PIN de un gerente (`managerOverride`).
 */
export async function completeSale(
  actor: Actor,
  input: unknown,
  client: PrismaClient = db,
  issuer: FiscalDocumentIssuer = caiRangeIssuer,
): Promise<CompletedSale> {
  requireCapability(actor, "sale.create");
  const parsed = saleInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(firstIssue(parsed.error));
  }
  const data = parsed.data;

  const existing = await findReplay(client, data.clientRequestId, actor.id);
  if (existing) {
    return existing;
  }

  // El PIN se verifica fuera de la transacción: un PIN malo cuenta como intento fallido aunque esta se revierta.
  const authorizer: SessionUser | null = data.managerOverride
    ? await authorizeWithManagerPin("discount.applyBeyondLimit", data.managerOverride, client)
    : null;

  try {
    return await client.$transaction((tx) => runSale(tx, actor, data, authorizer, issuer), {
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

/**
 * Crea la venta dentro de una transacción que ya existe. Con `creditCents` (un cambio) el valor de lo devuelto se aplica
 * primero, como un pago "Cambio", y `data.payments` cubre solo la diferencia.
 */
export async function runSale(
  tx: Tx,
  actor: Actor,
  data: SaleData,
  authorizer: SessionUser | null,
  issuer: FiscalDocumentIssuer,
  options: {
    /** Valor de lo devuelto en un cambio: paga la venta con un pago EXCHANGE. */
    creditCents?: number;
    /** Abonos ya recibidos de un apartado: pagan la venta con un pago LAYAWAY (ya entraron en su turno). */
    layawayCents?: number;
    /** Precios fijados al apartar, por prenda: se respetan aunque el catálogo haya cambiado. */
    unitPrices?: ReadonlyMap<string, number>;
  } = {},
): Promise<CompletedSale> {
  const now = new Date();

  // Dos cobros con el mismo identificador se atienden uno tras otro: el segundo ya ve la venta del primero.
  await tx.$queryRaw`
    SELECT 1 AS "locked" FROM (SELECT pg_advisory_xact_lock(hashtext(${`sale:${data.clientRequestId}`}))) AS "lock"
  `;
  const replay = await findReplay(tx, data.clientRequestId, actor.id);
  if (replay) {
    return replay;
  }

  // La venta cae en el turno abierto de la terminal. FOR SHARE: no estorba a otras ventas, pero el cierre de
  // caja (que pide FOR UPDATE) espera a que termine esta.
  const terminal = await getDefaultTerminal(tx);
  const [session] = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "CashSession"
    WHERE "terminalId" = ${terminal.id} AND "status" = 'OPEN'
    FOR SHARE
  `;
  if (!session) {
    throw new CashSessionClosedError();
  }

  const settings = await getSettings(tx);
  const variantIds = [...new Set(data.lines.map((line) => line.variantId))];
  // Las relaciones se cargan en fila: un `include` las lanzaría a la vez sobre la misma conexión de la transacción.
  const found = await tx.variant.findMany({ where: { id: { in: variantIds } } });
  const products = await tx.product.findMany({
    where: { id: { in: [...new Set(found.map((variant) => variant.productId))] } },
  });
  const sizes = await tx.size.findMany({
    where: { id: { in: found.flatMap((variant) => (variant.sizeId ? [variant.sizeId] : [])) } },
  });
  const colors = await tx.color.findMany({
    where: { id: { in: found.flatMap((variant) => (variant.colorId ? [variant.colorId] : [])) } },
  });
  const productById = new Map(products.map((product) => [product.id, product]));
  const sizeById = new Map(sizes.map((size) => [size.id, size]));
  const colorById = new Map(colors.map((color) => [color.id, color]));
  const byId = new Map(
    found.flatMap((variant) => {
      const product = productById.get(variant.productId);
      return product
        ? [
            [
              variant.id,
              {
                ...variant,
                product,
                size: variant.sizeId ? (sizeById.get(variant.sizeId) ?? null) : null,
                color: variant.colorId ? (colorById.get(variant.colorId) ?? null) : null,
              },
            ] as const,
          ]
        : [];
    }),
  );
  const items = data.lines.map((line) => {
    const variant = byId.get(line.variantId);
    if (!variant || variant.archivedAt !== null || variant.product.archivedAt !== null) {
      throw new NotFoundError("Variant not available");
    }
    return { line, variant };
  });

  const cart: CartLine[] = items.map(({ line, variant }) => ({
    unitPriceCents:
      options.unitPrices?.get(variant.id) ?? variant.priceCents ?? variant.product.basePriceCents,
    quantity: line.quantity,
    discount: line.discount,
    taxRateBps: variant.product.taxCategory === "EXEMPT" ? 0 : settings["tax.rate"],
  }));
  const priced = priceCart(cart, {
    globalDiscount: data.discount,
    pricesIncludeTax: settings["tax.pricesIncludeTax"],
  });
  if (priced.totalCents <= 0) {
    throw new ValidationError("A sale must have a total above zero");
  }

  // Descuentos: hace falta poder aplicarlos, y pasar del límite del cajero necesita la autorización de un gerente.
  const hasDiscount = data.discount !== undefined || data.lines.some((line) => line.discount);
  let overridden = false;
  if (hasDiscount) {
    requireCapability(actor, "discount.apply");
    if (!hasCapability(actor.role, "discount.applyBeyondLimit")) {
      const limit = settings["discount.maxPercent.CASHIER"];
      const exceeded =
        data.lines.some((line, index) =>
          discountExceedsLimit(line.discount, priced.lines[index]?.grossCents ?? 0, limit),
        ) || discountExceedsLimit(data.discount, priced.subtotalCents, limit);
      if (exceeded) {
        if (!authorizer) {
          throw new DiscountNeedsApprovalError();
        }
        overridden = true;
      }
    }
  }

  const enabled: readonly string[] = settings["payments.enabled"];
  if (
    data.payments.some(
      (payment) => payment.method !== "STORE_CREDIT" && !enabled.includes(payment.method),
    )
  ) {
    throw new ValidationError("A payment method is not enabled");
  }
  const storeCreditCents = sumCents(
    data.payments.filter((payment) => payment.method === "STORE_CREDIT").map((p) => p.amountCents),
  );
  if (storeCreditCents > 0 && !data.customerId) {
    throw new CustomerRequiredError();
  }
  const creditAppliedCents = Math.min(options.creditCents ?? 0, priced.totalCents);
  const layawayAppliedCents = Math.min(
    options.layawayCents ?? 0,
    priced.totalCents - creditAppliedCents,
  );
  const allPayments: { method: PaymentMethod; amountCents: number; reference?: string }[] = [
    ...(creditAppliedCents > 0
      ? [{ method: "EXCHANGE" as const, amountCents: creditAppliedCents }]
      : []),
    ...(layawayAppliedCents > 0
      ? [{ method: "LAYAWAY" as const, amountCents: layawayAppliedCents }]
      : []),
    ...data.payments,
  ];
  const { paidCents, changeCents } = settlePayments(priced.totalCents, allPayments);

  if (data.customerId) {
    const customer = await tx.customer.findFirst({
      where: { id: data.customerId, archivedAt: null },
      select: { id: true },
    });
    if (!customer) {
      throw new ValidationError("Unknown customer");
    }
  }

  const invoice: IssuedFiscalDocument | null = data.invoice
    ? await issuer.issue(tx, { terminalId: terminal.id, now })
    : null;
  const number = await nextDocumentNumber(tx, "SALE");

  const sale = await tx.sale.create({
    data: {
      number,
      clientRequestId: data.clientRequestId,
      locationId: terminal.locationId,
      terminalId: terminal.id,
      cashSessionId: session.id,
      sellerId: actor.id,
      customerId: data.customerId,
      subtotalCents: priced.subtotalCents,
      discountCents: priced.discountCents,
      taxCents: priced.taxCents,
      totalCents: priced.totalCents,
      paidCents,
      changeCents,
      fiscalDocType: invoice?.type,
      fiscalNumber: invoice?.number,
      fiscalRangeId: invoice?.rangeId,
      customerTaxId: data.invoice?.taxId,
      customerNameOnInvoice: data.invoice?.name,
    },
    select: { id: true },
  });
  // Líneas y pagos van en inserciones separadas y en fila: un `create` anidado de dos relaciones las lanzaría
  // a la vez sobre la misma conexión de la transacción.
  await tx.saleItem.createMany({
    data: items.map(({ line, variant }, index) => ({
      saleId: sale.id,
      variantId: variant.id,
      quantity: line.quantity,
      unitPriceCents: cart[index]?.unitPriceCents ?? 0,
      unitCostCents: snapshotCost(variant),
      lineDiscountCents: priced.lines[index]?.discountCents ?? 0,
      taxRate: cart[index]?.taxRateBps ?? 0,
      taxCents: priced.lines[index]?.taxCents ?? 0,
      lineTotalCents: priced.lines[index]?.lineTotalCents ?? 0,
      productName: variant.product.name,
      sizeName: variant.size?.name ?? null,
      colorName: variant.color?.name ?? null,
      sku: variant.sku,
    })),
  });
  await tx.payment.createMany({
    data: allPayments.map((payment) => ({
      saleId: sale.id,
      method: payment.method,
      amountCents: payment.amountCents,
      reference: payment.reference,
      cashSessionId: session.id,
    })),
  });

  // Las salidas de stock siempre en el mismo orden (por prenda): evita bloqueos cruzados con otras operaciones.
  const ordered = items
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => a.variant.id.localeCompare(b.variant.id) || a.index - b.index);
  for (const { line, variant } of ordered) {
    await recordMovement(tx, {
      variantId: variant.id,
      locationId: terminal.locationId,
      type: "SALE_OUT",
      quantity: -line.quantity,
      unitCostCents: snapshotCost(variant),
      userId: actor.id,
      refType: "Sale",
      refId: sale.id,
    });
  }

  if (storeCreditCents > 0 && data.customerId) {
    await applyStoreCredit(tx, {
      customerId: data.customerId,
      amountCents: -storeCreditCents,
      reason: "USED_IN_SALE",
      refType: "Sale",
      refId: sale.id,
      userId: actor.id,
    });
  }

  if (overridden && authorizer) {
    await audit.log(tx, {
      userId: actor.id,
      action: "DISCOUNT_OVERRIDE",
      entityType: "Sale",
      entityId: sale.id,
      after: {
        authorizedById: authorizer.id,
        discountCents: sumCents(priced.lines.map((line) => line.discountCents)),
        totalCents: priced.totalCents,
      },
      reason: DISCOUNT_OVERRIDE_REASON,
    });
  }

  return {
    id: sale.id,
    number,
    totalCents: priced.totalCents,
    paidCents,
    changeCents,
    fiscalNumber: invoice?.formattedNumber ?? null,
    creditAppliedCents,
    replayed: false,
  };
}

/** Costo que se copia a la línea: el promedio de la prenda; si aún no se compró nunca, el costo del catálogo. */
function snapshotCost(variant: {
  avgCostCents: number;
  costCents: number | null;
  product: { baseCostCents: number };
}): number {
  return variant.avgCostCents > 0
    ? variant.avgCostCents
    : (variant.costCents ?? variant.product.baseCostCents);
}

/**
 * Anula una venta de un turno todavía abierto: devuelve cada prenda al inventario y la venta queda marcada
 * (nunca se borra ni se edita). Pide motivo y a alguien con permiso de anular: un gerente o el propietario,
 * o un cajero con el PIN de un gerente. Las ventas anuladas no cuentan en el efectivo esperado. Una venta de
 * un turno ya cerrado no se anula: se corrige con una devolución. El número de factura, si tenía, se queda
 * usado (la numeración no tiene saltos).
 */
export async function voidSale(
  actor: Actor,
  saleId: string,
  input: unknown,
  client: PrismaClient = db,
): Promise<{ id: string; number: string }> {
  const parsed = voidSaleSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(firstIssue(parsed.error));
  }
  const data = parsed.data;

  let authorizer: SessionUser | null = null;
  if (!hasCapability(actor.role, "sale.void")) {
    if (!data.managerOverride) {
      throw new ForbiddenError(`Role ${actor.role} lacks capability sale.void`);
    }
    authorizer = await authorizeWithManagerPin("sale.void", data.managerOverride, client);
  }
  const responsibleId = authorizer?.id ?? actor.id;

  return client.$transaction(
    async (tx) => {
      const [sale] = await tx.$queryRaw<
        {
          id: string;
          number: string;
          status: string;
          totalCents: number;
          cashSessionId: string;
          locationId: string;
        }[]
      >`
        SELECT "id", "number", "status", "totalCents", "cashSessionId", "locationId"
        FROM "Sale" WHERE "id" = ${saleId} FOR UPDATE
      `;
      if (!sale) {
        throw new NotFoundError();
      }
      if (sale.status !== "COMPLETED") {
        throw new SaleStateError();
      }
      // Lo ya devuelto no se puede anular: la devolución es la corrección de esa venta.
      if ((await tx.returnDoc.count({ where: { saleId } })) > 0) {
        throw new SaleStateError("The sale has returns: it cannot be voided");
      }
      // Tampoco la que saldó un apartado: sus abonos ya están cobrados en otros turnos.
      if ((await tx.layaway.count({ where: { saleId } })) > 0) {
        throw new SaleStateError("The sale settled a layaway: use a return instead");
      }
      // La venta que nació de un cambio tampoco: anularla dejaría la devolución del cambio sin su venta.
      if ((await tx.returnDoc.count({ where: { exchangeSaleId: saleId } })) > 0) {
        throw new SaleStateError("The sale came from an exchange: use a return instead");
      }
      // El turno se bloquea igual que al vender: el cierre de caja no puede cruzarse con una anulación.
      const [session] = await tx.$queryRaw<{ status: string }[]>`
        SELECT "status" FROM "CashSession" WHERE "id" = ${sale.cashSessionId} FOR SHARE
      `;
      if (session?.status !== "OPEN") {
        throw new SaleStateError("The shift of this sale is closed: use a return instead");
      }

      const items = await tx.saleItem.findMany({
        where: { saleId },
        orderBy: [{ variantId: "asc" }, { id: "asc" }],
        select: { variantId: true, quantity: true, unitCostCents: true },
      });
      for (const item of items) {
        await recordMovement(tx, {
          variantId: item.variantId,
          locationId: sale.locationId,
          type: "RETURN_IN",
          quantity: item.quantity,
          unitCostCents: item.unitCostCents,
          userId: actor.id,
          reason: `${VOID_STOCK_REASON} ${sale.number}`,
          refType: "Sale",
          refId: saleId,
        });
      }

      // Lo pagado con crédito de tienda vuelve al saldo del cliente (queda en el libro como "venta anulada").
      const spentCredit = await tx.payment.aggregate({
        _sum: { amountCents: true },
        where: { saleId, method: "STORE_CREDIT" },
      });
      const creditToRestore = spentCredit._sum.amountCents ?? 0;
      if (creditToRestore > 0) {
        const owner = await tx.sale.findUniqueOrThrow({
          where: { id: saleId },
          select: { customerId: true },
        });
        if (!owner.customerId) {
          throw new SaleStateError("A sale paid with store credit must have a customer");
        }
        await applyStoreCredit(tx, {
          customerId: owner.customerId,
          amountCents: creditToRestore,
          reason: "SALE_VOID",
          refType: "Sale",
          refId: saleId,
          userId: actor.id,
        });
      }

      await tx.sale.update({
        where: { id: saleId },
        data: {
          status: "VOIDED",
          voidedAt: new Date(),
          voidedById: responsibleId,
          voidReason: data.reason,
        },
      });
      await audit.log(tx, {
        userId: actor.id,
        action: "SALE_VOIDED",
        entityType: "Sale",
        entityId: saleId,
        before: { status: "COMPLETED", totalCents: sale.totalCents },
        after: { status: "VOIDED", ...(authorizer ? { authorizedById: authorizer.id } : {}) },
        reason: data.reason,
      });
      return { id: saleId, number: sale.number };
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
}

/**
 * Deja constancia de un ticket que se descartó sin cobrar (cancelar la venta o descartar una en espera): quién, por qué y
 * qué tenía. El ticket vive en el navegador y no toca inventario ni dinero, así que este es su único registro.
 */
export async function logCancelledTicket(
  actor: Actor,
  input: unknown,
  client: PrismaClient = db,
): Promise<void> {
  requireCapability(actor, "sale.create");
  const parsed = cancelTicketSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(firstIssue(parsed.error));
  }
  const { reason, source, lines } = parsed.data;
  const session = await client.cashSession.findFirst({
    where: { userId: actor.id, status: "OPEN" },
    select: { id: true },
  });
  await audit.log(client, {
    userId: actor.id,
    action: "TICKET_CANCELLED",
    entityType: session ? "CashSession" : "User",
    entityId: session?.id ?? actor.id,
    after: {
      source,
      units: lines.reduce((total, line) => total + line.quantity, 0),
      grossCents: sumCents(lines.map((line) => mulCents(line.unitPriceCents, line.quantity))),
      lines,
    },
    reason,
  });
}
