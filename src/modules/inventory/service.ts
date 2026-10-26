import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { StockMovementType } from "@/generated/prisma/enums";
import { InsufficientStockError, NotFoundError, ValidationError } from "@/lib/errors";

type MovementClient = Pick<Prisma.TransactionClient, "stockMovement" | "stockLevel">;

export type MovementInput = {
  variantId: string;
  locationId: string;
  type: StockMovementType;
  /** Con signo: positivo entra, negativo sale. */
  quantity: number;
  unitCostCents?: number;
  userId: string;
  reason?: string;
  refType?: string;
  refId?: string;
  /** Solo si el ajuste "permitir stock negativo" está activo (CLAUDE.md §6.6). */
  allowNegative?: boolean;
};

/**
 * Única puerta para cambiar existencias (CLAUDE.md §6.2): escribe el movimiento (kardex) y actualiza
 * el acumulado en la misma transacción. Debe llamarse con el cliente de una transacción.
 */
export async function recordMovement(tx: MovementClient, input: MovementInput): Promise<void> {
  if (!Number.isSafeInteger(input.quantity) || input.quantity === 0) {
    throw new ValidationError("Movement quantity must be a non-zero integer");
  }
  await tx.stockMovement.create({
    data: {
      variantId: input.variantId,
      locationId: input.locationId,
      type: input.type,
      quantity: input.quantity,
      unitCostCents: input.unitCostCents ?? 0,
      refType: input.refType,
      refId: input.refId,
      reason: input.reason,
      userId: input.userId,
    },
  });
  const level = await tx.stockLevel.upsert({
    where: { variantId_locationId: { variantId: input.variantId, locationId: input.locationId } },
    create: { variantId: input.variantId, locationId: input.locationId, onHand: input.quantity },
    update: { onHand: { increment: input.quantity } },
  });
  if (level.onHand < 0 && !input.allowNegative) {
    throw new InsufficientStockError();
  }
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
