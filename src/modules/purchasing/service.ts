import type { z } from "zod";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { parseLocalDateKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { nextDocumentNumber } from "@/lib/document-number";
import { NotFoundError, OrderStateError, OverReceiptError, ValidationError } from "@/lib/errors";
import { mulCents, sumCents } from "@/lib/money";
import { hasCapability, requireCapability } from "@/lib/permissions";
import type { Actor } from "@/modules/catalog/service";
import { getDefaultLocationId, recordMovement } from "@/modules/inventory/service";
import {
  purchaseOrderSchema,
  receiptSchema,
  type PurchaseOrderInput,
} from "@/modules/purchasing/schemas";

type Tx = Prisma.TransactionClient;

function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(result.error.issues[0]?.message ?? "Invalid input");
  }
  return result.data;
}

/** Pedir mercadería lleva costos: además de poder recibir, hay que poder verlos. */
function requireOrdering(actor: Actor): void {
  requireCapability(actor, "purchase.receive");
  requireCapability(actor, "product.viewCost");
}

async function assertSupplier(tx: Tx, supplierId: string): Promise<void> {
  if ((await tx.supplier.count({ where: { id: supplierId, archivedAt: null } })) !== 1) {
    throw new ValidationError("Unknown or archived supplier");
  }
}

async function assertVariants(tx: Tx, variantIds: string[]): Promise<void> {
  const found = await tx.variant.count({
    where: { id: { in: variantIds }, archivedAt: null, product: { archivedAt: null } },
  });
  if (found !== new Set(variantIds).size) {
    throw new ValidationError("Unknown or archived variant");
  }
}

// ───────────────────────── Órdenes de compra ─────────────────────────

function orderData(data: PurchaseOrderInput) {
  return {
    supplierId: data.supplierId,
    expectedAt: data.expectedAt ? (parseLocalDateKey(data.expectedAt) as Date) : null,
    notes: data.notes ?? null,
  };
}

export async function createPurchaseOrder(
  actor: Actor,
  input: unknown,
  client: PrismaClient = db,
): Promise<{ id: string; number: string }> {
  requireOrdering(actor);
  const data = parseInput(purchaseOrderSchema, input);
  return client.$transaction(async (tx) => {
    await assertSupplier(tx, data.supplierId);
    await assertVariants(
      tx,
      data.items.map((item) => item.variantId),
    );
    const number = await nextDocumentNumber(tx, "PURCHASE_ORDER");
    const order = await tx.purchaseOrder.create({
      data: {
        number,
        ...orderData(data),
        locationId: await getDefaultLocationId(tx),
        createdById: actor.id,
        items: { create: data.items },
      },
    });
    return { id: order.id, number };
  });
}

/** Cambia una orden mientras es borrador: reemplaza sus datos y sus prendas. */
export async function updatePurchaseOrder(
  actor: Actor,
  id: string,
  input: unknown,
  client: PrismaClient = db,
): Promise<void> {
  requireOrdering(actor);
  const data = parseInput(purchaseOrderSchema, input);
  await client.$transaction(async (tx) => {
    const order = await tx.purchaseOrder.findUnique({ where: { id }, select: { status: true } });
    if (!order) {
      throw new NotFoundError();
    }
    if (order.status !== "DRAFT") {
      throw new OrderStateError();
    }
    await assertSupplier(tx, data.supplierId);
    await assertVariants(
      tx,
      data.items.map((item) => item.variantId),
    );
    await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } });
    await tx.purchaseOrder.update({
      where: { id },
      data: { ...orderData(data), items: { create: data.items } },
    });
  });
}

/** Borrador → pedida. */
export async function placePurchaseOrder(
  actor: Actor,
  id: string,
  client: PrismaClient = db,
): Promise<void> {
  requireOrdering(actor);
  await client.$transaction(async (tx) => {
    const updated = await tx.purchaseOrder.updateMany({
      where: { id, status: "DRAFT" },
      data: { status: "ORDERED" },
    });
    if (updated.count === 0) {
      await failOrderState(tx, id);
    }
  });
}

/** Cancela una orden que todavía no recibió nada (borrador o pedida). */
export async function cancelPurchaseOrder(
  actor: Actor,
  id: string,
  client: PrismaClient = db,
): Promise<void> {
  requireOrdering(actor);
  await client.$transaction(async (tx) => {
    const updated = await tx.purchaseOrder.updateMany({
      where: { id, status: { in: ["DRAFT", "ORDERED"] } },
      data: { status: "CANCELLED" },
    });
    if (updated.count === 0) {
      await failOrderState(tx, id);
    }
  });
}

async function failOrderState(tx: Tx, id: string): Promise<never> {
  if ((await tx.purchaseOrder.count({ where: { id } })) === 0) {
    throw new NotFoundError();
  }
  throw new OrderStateError();
}

// ───────────────────────── Recepción de mercadería ─────────────────────────

/**
 * Recibe mercadería (con orden o sin ella): crea la recepción con su número correlativo, hace entrar cada
 * prenda al inventario como `PURCHASE_IN` con su costo (lo que recalcula el costo promedio) y, si hay
 * orden, suma lo recibido. Todo en una transacción: o entra completo o no entra nada.
 *
 * Quien no ve costos no los captura: se usa el de la orden, o el costo promedio actual de la prenda.
 */
export async function receiveGoods(
  actor: Actor,
  input: unknown,
  client: PrismaClient = db,
): Promise<{ id: string; number: string }> {
  requireCapability(actor, "purchase.receive");
  const data = parseInput(receiptSchema, input);
  const mayCaptureCost = hasCapability(actor.role, "product.viewCost");

  return client.$transaction(
    async (tx) => {
      let supplierId = data.supplierId;
      let orderItems: { id: string; variantId: string; unitCostCents: number }[] = [];

      if (data.purchaseOrderId) {
        // Bloquea la orden: dos recepciones de la misma orden se atienden una tras otra.
        const [order] = await tx.$queryRaw<{ status: string; supplierId: string }[]>`
          SELECT "status", "supplierId" FROM "PurchaseOrder"
          WHERE "id" = ${data.purchaseOrderId} FOR UPDATE
        `;
        if (!order) {
          throw new NotFoundError();
        }
        if (order.status !== "ORDERED" && order.status !== "PARTIALLY_RECEIVED") {
          throw new OrderStateError();
        }
        supplierId = order.supplierId;
        orderItems = await tx.purchaseOrderItem.findMany({
          where: { purchaseOrderId: data.purchaseOrderId },
          select: { id: true, variantId: true, unitCostCents: true },
        });
      } else if (supplierId) {
        await assertSupplier(tx, supplierId);
      }
      if (!supplierId) {
        throw new ValidationError("Supplier is required");
      }

      // Siempre en el mismo orden (por prenda): evita bloqueos cruzados entre recepciones simultáneas.
      const items = [...data.items].sort((a, b) => a.variantId.localeCompare(b.variantId));
      const variants = await tx.variant.findMany({
        where: {
          id: { in: items.map((item) => item.variantId) },
          archivedAt: null,
          product: { archivedAt: null },
        },
        select: { id: true, avgCostCents: true, product: { select: { baseCostCents: true } } },
      });
      if (variants.length !== items.length) {
        throw new ValidationError("Unknown or archived variant");
      }
      const variantById = new Map(variants.map((variant) => [variant.id, variant]));

      const lines = items.map((item) => {
        const orderItem = orderItems.find((candidate) => candidate.variantId === item.variantId);
        if (data.purchaseOrderId && !orderItem) {
          throw new ValidationError("The variant is not in the purchase order");
        }
        const variant = variantById.get(item.variantId);
        const fallback = orderItem
          ? orderItem.unitCostCents
          : variant && variant.avgCostCents > 0
            ? variant.avgCostCents
            : (variant?.product.baseCostCents ?? 0);
        return {
          variantId: item.variantId,
          quantity: item.quantity,
          unitCostCents:
            mayCaptureCost && item.unitCostCents !== undefined ? item.unitCostCents : fallback,
          orderItemId: orderItem?.id,
        };
      });

      const locationId = await getDefaultLocationId(tx);
      const number = await nextDocumentNumber(tx, "GOODS_RECEIPT");
      const receipt = await tx.goodsReceipt.create({
        data: {
          number,
          supplierId,
          locationId,
          purchaseOrderId: data.purchaseOrderId ?? null,
          supplierInvoiceRef: data.supplierInvoiceRef ?? null,
          receivedById: actor.id,
          items: {
            create: lines.map((line) => ({
              variantId: line.variantId,
              quantity: line.quantity,
              unitCostCents: line.unitCostCents,
            })),
          },
        },
      });

      for (const line of lines) {
        if (line.orderItemId) {
          const updated = await tx.$queryRaw<{ id: string }[]>`
            UPDATE "PurchaseOrderItem"
            SET "receivedQty" = "receivedQty" + ${line.quantity}::int, "updatedAt" = now()
            WHERE "id" = ${line.orderItemId}
              AND "receivedQty" + ${line.quantity}::int <= "orderedQty"
            RETURNING "id"
          `;
          if (updated.length === 0) {
            throw new OverReceiptError();
          }
        }
        await recordMovement(tx, {
          variantId: line.variantId,
          locationId,
          type: "PURCHASE_IN",
          quantity: line.quantity,
          unitCostCents: line.unitCostCents,
          userId: actor.id,
          refType: "GoodsReceipt",
          refId: receipt.id,
        });
      }

      if (data.purchaseOrderId) {
        const pending = await tx.$queryRaw<{ n: number }[]>`
          SELECT count(*)::int AS "n" FROM "PurchaseOrderItem"
          WHERE "purchaseOrderId" = ${data.purchaseOrderId} AND "receivedQty" < "orderedQty"
        `;
        await tx.purchaseOrder.update({
          where: { id: data.purchaseOrderId },
          data: { status: (pending[0]?.n ?? 0) === 0 ? "RECEIVED" : "PARTIALLY_RECEIVED" },
        });
      }

      await audit.log(tx, {
        userId: actor.id,
        action: "GOODS_RECEIVED",
        entityType: "GoodsReceipt",
        entityId: receipt.id,
        after: {
          number,
          supplierId,
          purchaseOrderId: data.purchaseOrderId ?? null,
          lines: lines.length,
          units: lines.reduce((sum, line) => sum + line.quantity, 0),
          totalCostCents: sumCents(
            lines.map((line) => mulCents(line.unitCostCents, line.quantity)),
          ),
        },
      });
      return { id: receipt.id, number };
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}
