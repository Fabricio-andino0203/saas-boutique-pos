import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { StockMovementType } from "@/generated/prisma/enums";
import { InsufficientStockError, NotFoundError, ValidationError } from "@/lib/errors";
import { weightedAverageCents } from "@/lib/money";
import { getSetting } from "@/lib/settings";

type Tx = Prisma.TransactionClient;

/** Tipos que siempre suman, que siempre restan, y los que pueden ir en cualquier sentido. */
const INBOUND: readonly StockMovementType[] = [
  "PURCHASE_IN",
  "RETURN_IN",
  "ADJUSTMENT_IN",
  "TRANSFER_IN",
  "INITIAL",
];
const OUTBOUND: readonly StockMovementType[] = [
  "SALE_OUT",
  "RETURN_SCRAP",
  "ADJUSTMENT_OUT",
  "TRANSFER_OUT",
];

export type MovementInput = {
  variantId: string;
  locationId: string;
  type: StockMovementType;
  /** Con signo: positivo entra, negativo sale. */
  quantity: number;
  /** Costo unitario al momento; si falta, se usa el costo promedio actual de la variante. */
  unitCostCents?: number;
  userId: string;
  reason?: string;
  refType?: string;
  refId?: string;
  /** Fuerza permitir (o prohibir) stock negativo; si falta, manda el ajuste `sales.allowNegativeStock`. */
  allowNegative?: boolean;
};

function assertSign(input: MovementInput): void {
  if (!Number.isSafeInteger(input.quantity) || input.quantity === 0) {
    throw new ValidationError("Movement quantity must be a non-zero integer");
  }
  if (input.type === "LAYAWAY_RESERVE" || input.type === "LAYAWAY_RELEASE") {
    // Las reservas cambian `reserved`, no `onHand`: llegan con la Fase 4.
    throw new ValidationError("Layaway movements are not supported yet");
  }
  if (INBOUND.includes(input.type) && input.quantity < 0) {
    throw new ValidationError(`${input.type} must have a positive quantity`);
  }
  if (OUTBOUND.includes(input.type) && input.quantity > 0) {
    throw new ValidationError(`${input.type} must have a negative quantity`);
  }
}

/**
 * Entrada de compra: recalcula el costo promedio de la variante con la existencia que había antes.
 * Toma el bloqueo de la fila de la variante, así dos recepciones simultáneas no se pisan.
 */
async function applyPurchaseCost(tx: Tx, input: MovementInput): Promise<number> {
  const unitCost = input.unitCostCents ?? 0;
  const [variant] = await tx.$queryRaw<{ avgCostCents: number }[]>`
    SELECT "avgCostCents" FROM "Variant" WHERE "id" = ${input.variantId} FOR UPDATE
  `;
  if (!variant) {
    throw new NotFoundError("Variant not found");
  }
  const [stock] = await tx.$queryRaw<{ total: number }[]>`
    SELECT COALESCE(SUM("onHand"), 0)::int AS "total" FROM "StockLevel"
    WHERE "variantId" = ${input.variantId}
  `;
  const next = weightedAverageCents(
    stock?.total ?? 0,
    variant.avgCostCents,
    input.quantity,
    unitCost,
  );
  if (next !== variant.avgCostCents) {
    await tx.variant.update({ where: { id: input.variantId }, data: { avgCostCents: next } });
  }
  return unitCost;
}

/**
 * Única puerta para cambiar existencias (CLAUDE.md §6.2): actualiza el acumulado y escribe el movimiento
 * (kardex) en la misma transacción, que debe pasar quien llama.
 *
 * Concurrencia: el acumulado se cambia con un solo `UPDATE` condicionado (`onHand + cantidad >= 0`), que
 * toma el bloqueo de la fila. Si dos cajeros sacan la última prenda a la vez, el segundo espera, ve el
 * valor ya descontado y falla con `InsufficientStockError`. La fila se crea con `ON CONFLICT DO NOTHING`,
 * así dos primeras entradas simultáneas de una variante nueva tampoco se estorban.
 */
export async function recordMovement(tx: Tx, input: MovementInput): Promise<void> {
  assertSign(input);
  const allowNegative = input.allowNegative ?? (await getSetting(tx, "sales.allowNegativeStock"));

  let unitCostCents = input.unitCostCents;
  if (input.type === "PURCHASE_IN") {
    unitCostCents = await applyPurchaseCost(tx, input);
  } else if (unitCostCents === undefined) {
    const variant = await tx.variant.findUnique({
      where: { id: input.variantId },
      select: { avgCostCents: true },
    });
    if (!variant) {
      throw new NotFoundError("Variant not found");
    }
    unitCostCents = variant.avgCostCents;
  }

  await tx.$executeRaw`
    INSERT INTO "StockLevel" ("id", "variantId", "locationId", "onHand", "reserved", "createdAt", "updatedAt")
    VALUES (gen_random_uuid()::text, ${input.variantId}, ${input.locationId}, 0, 0, now(), now())
    ON CONFLICT ("variantId", "locationId") DO NOTHING
  `;
  const updated = await tx.$queryRaw<{ onHand: number }[]>`
    UPDATE "StockLevel"
    SET "onHand" = "onHand" + ${input.quantity}::int, "updatedAt" = now()
    WHERE "variantId" = ${input.variantId}
      AND "locationId" = ${input.locationId}
      AND (${allowNegative}::boolean OR "onHand" + ${input.quantity}::int >= 0)
    RETURNING "onHand"
  `;
  if (updated.length === 0) {
    throw new InsufficientStockError();
  }

  await tx.stockMovement.create({
    data: {
      variantId: input.variantId,
      locationId: input.locationId,
      type: input.type,
      quantity: input.quantity,
      unitCostCents,
      refType: input.refType,
      refId: input.refId,
      reason: input.reason,
      userId: input.userId,
    },
  });
}

/** Existencia actual de una variante en una ubicación, con la fila bloqueada hasta que termine la transacción. */
export async function lockOnHand(tx: Tx, variantId: string, locationId: string): Promise<number> {
  const rows = await tx.$queryRaw<{ onHand: number }[]>`
    SELECT "onHand" FROM "StockLevel"
    WHERE "variantId" = ${variantId} AND "locationId" = ${locationId}
    FOR UPDATE
  `;
  return rows[0]?.onHand ?? 0;
}

/** La ubicación donde se vende hoy (la tienda principal). */
export async function getDefaultLocationId(
  client: Pick<PrismaClient, "location">,
): Promise<string> {
  const location = await client.location.findFirst({
    where: { isDefault: true },
    select: { id: true },
  });
  if (!location) {
    throw new NotFoundError("No default location configured");
  }
  return location.id;
}
