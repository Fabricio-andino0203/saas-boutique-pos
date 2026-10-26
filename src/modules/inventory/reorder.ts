import type { PrismaClient } from "@/generated/prisma/client";
import { db } from "@/lib/db";

export type ReorderAlert = {
  variantId: string;
  productId: string;
  productName: string;
  label: string;
  sku: string;
  onHand: number;
  reorderPoint: number;
  /** Cuántas faltan para llegar al mínimo (0 si ya está justo en el mínimo). */
  missing: number;
  /** Lo que ya se pidió y todavía no llega (órdenes pedidas o recibidas en parte). */
  onOrder: number;
};

/**
 * Prendas que están en su mínimo de reposición o por debajo (RF-INV-6), de las que falta más a las que
 * falta menos, con lo que ya está pedido para no pedirlo dos veces.
 */
export async function listReorderAlerts(client: PrismaClient = db): Promise<ReorderAlert[]> {
  const variants = await client.variant.findMany({
    where: { archivedAt: null, reorderPoint: { not: null }, product: { archivedAt: null } },
    select: {
      id: true,
      sku: true,
      reorderPoint: true,
      product: { select: { id: true, name: true } },
      size: { select: { name: true } },
      color: { select: { name: true } },
      stockLevels: { select: { onHand: true } },
    },
  });
  const low = variants.flatMap((variant) => {
    const onHand = variant.stockLevels.reduce((sum, level) => sum + level.onHand, 0);
    return variant.reorderPoint !== null && onHand <= variant.reorderPoint
      ? [{ variant, onHand, reorderPoint: variant.reorderPoint }]
      : [];
  });
  if (low.length === 0) {
    return [];
  }

  const pending = await client.purchaseOrderItem.findMany({
    where: {
      variantId: { in: low.map((entry) => entry.variant.id) },
      purchaseOrder: { status: { in: ["ORDERED", "PARTIALLY_RECEIVED"] } },
    },
    select: { variantId: true, orderedQty: true, receivedQty: true },
  });
  const onOrder = new Map<string, number>();
  for (const item of pending) {
    onOrder.set(
      item.variantId,
      (onOrder.get(item.variantId) ?? 0) + Math.max(0, item.orderedQty - item.receivedQty),
    );
  }

  return low
    .map(({ variant, onHand, reorderPoint }) => ({
      variantId: variant.id,
      productId: variant.product.id,
      productName: variant.product.name,
      label: [variant.size?.name, variant.color?.name].filter(Boolean).join(" · "),
      sku: variant.sku,
      onHand,
      reorderPoint,
      missing: Math.max(0, reorderPoint - onHand),
      onOrder: onOrder.get(variant.id) ?? 0,
    }))
    .sort(
      (a, b) =>
        b.missing - a.missing ||
        a.productName.localeCompare(b.productName, "es") ||
        a.sku.localeCompare(b.sku),
    );
}
