import { z } from "zod";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import {
  CountInProgressError,
  CountStateError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { requireCapability } from "@/lib/permissions";
import { descendantsOf, type Actor } from "@/modules/catalog/service";
import { getDefaultLocationId, lockOnHand, recordMovement } from "@/modules/inventory/service";

type Tx = Prisma.TransactionClient;

export const openCountSchema = z
  .object({
    scope: z.enum(["ALL", "CATEGORY"]),
    categoryId: z.preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
      z.string().trim().min(1).max(40).optional(),
    ),
  })
  .refine((value) => value.scope === "ALL" || value.categoryId !== undefined, {
    path: ["categoryId"],
    message: "Category is required",
  });

export const COUNT_REASON = "Conteo físico";

/**
 * Abre un conteo: congela cuánto dice el sistema que hay de cada prenda activa (de todo, o de una
 * categoría con sus subcategorías). Solo puede haber un conteo en curso por ubicación.
 */
export async function openCount(
  actor: Actor,
  input: unknown,
  client: PrismaClient = db,
): Promise<{ id: string; items: number }> {
  requireCapability(actor, "stock.adjust");
  const parsed = openCountSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const data = parsed.data;

  return client.$transaction(
    async (tx) => {
      const locationId = await getDefaultLocationId(tx);
      // Bloquea la ubicación: dos aperturas simultáneas se atienden una tras otra.
      await tx.$queryRaw`SELECT "id" FROM "Location" WHERE "id" = ${locationId} FOR UPDATE`;
      const open = await tx.stockCount.count({
        where: { locationId, status: { in: ["OPEN", "IN_REVIEW"] } },
      });
      if (open > 0) {
        throw new CountInProgressError();
      }

      let categoryIds: string[] | undefined;
      if (data.scope === "CATEGORY") {
        const categories = await tx.category.findMany({ select: { id: true, parentId: true } });
        if (!categories.some((category) => category.id === data.categoryId)) {
          throw new ValidationError("Unknown category");
        }
        categoryIds = [
          data.categoryId as string,
          ...descendantsOf(categories, data.categoryId as string),
        ];
      }

      const variants = await tx.variant.findMany({
        where: {
          archivedAt: null,
          product: {
            archivedAt: null,
            ...(categoryIds ? { categoryId: { in: categoryIds } } : {}),
          },
        },
        select: { id: true },
      });
      if (variants.length === 0) {
        throw new ValidationError("There is nothing to count");
      }
      const levels = await tx.stockLevel.findMany({
        where: { locationId, variantId: { in: variants.map((variant) => variant.id) } },
        select: { variantId: true, onHand: true },
      });
      const onHand = new Map(levels.map((level) => [level.variantId, level.onHand]));

      const count = await tx.stockCount.create({
        data: {
          locationId,
          scope: data.scope,
          scopeRef: data.scope === "CATEGORY" ? (data.categoryId as string) : null,
          startedById: actor.id,
          items: {
            create: variants.map((variant) => ({
              variantId: variant.id,
              expectedQty: onHand.get(variant.id) ?? 0,
            })),
          },
        },
      });
      return { id: count.id, items: variants.length };
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}

export type ScanResult =
  | { found: false }
  | {
      found: true;
      item: {
        variantId: string;
        productName: string;
        label: string;
        sku: string;
        expectedQty: number;
        countedQty: number;
        /** Pasó de no contada (0) a contada: sirve para el avance. */
        becameCounted: boolean;
      };
    };

/**
 * Suma (o resta, con `delta` negativo) una unidad contada a la prenda con ese código de barras o código.
 * El contador no baja de cero. Solo mientras el conteo está abierto.
 */
export async function scanCount(
  actor: Actor,
  countId: string,
  code: string,
  delta = 1,
  client: PrismaClient = db,
): Promise<ScanResult> {
  requireCapability(actor, "stock.adjust");
  const term = code.trim();
  if (term === "" || !Number.isInteger(delta) || delta === 0) {
    return { found: false };
  }
  return client.$transaction(async (tx) => {
    const count = await tx.stockCount.findUnique({
      where: { id: countId },
      select: { status: true },
    });
    if (!count) {
      throw new NotFoundError();
    }
    if (count.status !== "OPEN") {
      throw new CountStateError();
    }
    const item = await tx.stockCountItem.findFirst({
      where: {
        stockCountId: countId,
        variant: { OR: [{ barcode: term }, { sku: { equals: term, mode: "insensitive" } }] },
      },
      include: {
        variant: {
          select: {
            sku: true,
            product: { select: { name: true } },
            size: { select: { name: true } },
            color: { select: { name: true } },
          },
        },
      },
    });
    if (!item) {
      return { found: false } as const;
    }
    const [updated] = await tx.$queryRaw<{ countedQty: number }[]>`
      UPDATE "StockCountItem"
      SET "countedQty" = GREATEST(0, "countedQty" + ${delta}::int), "updatedAt" = now()
      WHERE "id" = ${item.id}
      RETURNING "countedQty"
    `;
    const countedQty = updated?.countedQty ?? item.countedQty;
    return {
      found: true,
      item: {
        variantId: item.variantId,
        productName: item.variant.product.name,
        label: [item.variant.size?.name, item.variant.color?.name].filter(Boolean).join(" · "),
        sku: item.variant.sku,
        expectedQty: item.expectedQty,
        countedQty,
        becameCounted: item.countedQty === 0 && countedQty > 0,
      },
    } as const;
  });
}

/** Escribe a mano la cantidad contada de una prenda del conteo (solo mientras está abierto). */
export async function setCountedQty(
  actor: Actor,
  itemId: string,
  quantity: number,
  client: PrismaClient = db,
): Promise<void> {
  requireCapability(actor, "stock.adjust");
  if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > 1_000_000) {
    throw new ValidationError("Counted quantity must be a whole number, zero or more");
  }
  const updated = await client.stockCountItem.updateMany({
    where: { id: itemId, stockCount: { status: "OPEN" } },
    data: { countedQty: quantity },
  });
  if (updated.count === 0) {
    if ((await client.stockCountItem.count({ where: { id: itemId } })) === 0) {
      throw new NotFoundError();
    }
    throw new CountStateError();
  }
}

async function moveCount(
  tx: Tx,
  id: string,
  from: ("OPEN" | "IN_REVIEW")[],
  to: "OPEN" | "IN_REVIEW" | "CANCELLED",
): Promise<void> {
  const updated = await tx.stockCount.updateMany({
    where: { id, status: { in: from } },
    data: { status: to },
  });
  if (updated.count === 0) {
    if ((await tx.stockCount.count({ where: { id } })) === 0) {
      throw new NotFoundError();
    }
    throw new CountStateError();
  }
}

/** Termina de contar y pasa a revisar las diferencias. */
export async function submitCountForReview(
  actor: Actor,
  id: string,
  client: PrismaClient = db,
): Promise<void> {
  requireCapability(actor, "stock.adjust");
  await client.$transaction((tx) => moveCount(tx, id, ["OPEN"], "IN_REVIEW"));
}

/** Vuelve a contar (desde la revisión). */
export async function reopenCount(
  actor: Actor,
  id: string,
  client: PrismaClient = db,
): Promise<void> {
  requireCapability(actor, "stock.adjust");
  await client.$transaction((tx) => moveCount(tx, id, ["IN_REVIEW"], "OPEN"));
}

/** Cancela el conteo sin tocar ninguna existencia. */
export async function cancelCount(
  actor: Actor,
  id: string,
  client: PrismaClient = db,
): Promise<void> {
  requireCapability(actor, "stock.adjust");
  await client.$transaction((tx) => moveCount(tx, id, ["OPEN", "IN_REVIEW"], "CANCELLED"));
}

/**
 * Aprueba y aplica el conteo: deja la existencia de cada prenda igual a lo contado, con un movimiento
 * `COUNT_ADJUSTMENT` por cada diferencia (las que ya coinciden no generan nada). La diferencia se calcula
 * contra lo que hay en el momento de aplicar, con la fila bloqueada.
 */
export async function applyCount(
  actor: Actor,
  id: string,
  client: PrismaClient = db,
): Promise<{ adjustments: number; units: number }> {
  requireCapability(actor, "stock.approveCount");
  return client.$transaction(
    async (tx) => {
      const [count] = await tx.$queryRaw<{ status: string; locationId: string }[]>`
        SELECT "status", "locationId" FROM "StockCount" WHERE "id" = ${id} FOR UPDATE
      `;
      if (!count) {
        throw new NotFoundError();
      }
      if (count.status !== "IN_REVIEW") {
        throw new CountStateError();
      }

      // Siempre en el mismo orden (por prenda): evita bloqueos cruzados con otras operaciones.
      const items = await tx.stockCountItem.findMany({
        where: { stockCountId: id },
        orderBy: { variantId: "asc" },
        select: { variantId: true, countedQty: true },
      });
      let adjustments = 0;
      let units = 0;
      for (const item of items) {
        const current = await lockOnHand(tx, item.variantId, count.locationId);
        const delta = item.countedQty - current;
        if (delta === 0) {
          continue;
        }
        await recordMovement(tx, {
          variantId: item.variantId,
          locationId: count.locationId,
          type: "COUNT_ADJUSTMENT",
          quantity: delta,
          userId: actor.id,
          reason: COUNT_REASON,
          refType: "StockCount",
          refId: id,
        });
        adjustments += 1;
        units += Math.abs(delta);
      }

      await tx.stockCount.update({
        where: { id },
        data: { status: "APPLIED", approvedById: actor.id, appliedAt: new Date() },
      });
      await audit.log(tx, {
        userId: actor.id,
        action: "STOCK_ADJUSTED",
        entityType: "StockCount",
        entityId: id,
        after: { adjustments, units },
        reason: COUNT_REASON,
      });
      return { adjustments, units };
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
}
