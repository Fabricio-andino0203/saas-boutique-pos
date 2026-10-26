import type { PrismaClient } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { requireCapability } from "@/lib/permissions";
import type { Actor } from "@/modules/catalog/service";
import { adjustmentSchema, reasonText } from "@/modules/inventory/reasons";
import { getDefaultLocationId, lockOnHand, recordMovement } from "@/modules/inventory/service";

/**
 * Ajuste manual de existencias con motivo obligatorio. Con "La existencia real es" se calcula la
 * diferencia contra lo que hay (con el registro bloqueado, para que dos ajustes no se pisen).
 */
export async function adjustStock(
  actor: Actor,
  input: unknown,
  client: PrismaClient = db,
): Promise<{ delta: number; onHand: number }> {
  requireCapability(actor, "stock.adjust");
  const parsed = adjustmentSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const data = parsed.data;

  return client.$transaction(async (tx) => {
    const variant = await tx.variant.findUnique({
      where: { id: data.variantId },
      select: { id: true, sku: true },
    });
    if (!variant) {
      throw new NotFoundError();
    }
    const locationId = await getDefaultLocationId(tx);
    const current = await lockOnHand(tx, variant.id, locationId);
    const delta =
      data.mode === "in"
        ? data.quantity
        : data.mode === "out"
          ? -data.quantity
          : data.quantity - current;
    if (delta === 0) {
      return { delta: 0, onHand: current };
    }

    const reason = reasonText(data.reason, data.note);
    await recordMovement(tx, {
      variantId: variant.id,
      locationId,
      type: delta > 0 ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT",
      quantity: delta,
      userId: actor.id,
      reason,
    });
    await audit.log(tx, {
      userId: actor.id,
      action: "STOCK_ADJUSTED",
      entityType: "Variant",
      entityId: variant.id,
      before: { onHand: current },
      after: { onHand: current + delta },
      reason,
    });
    return { delta, onHand: current + delta };
  });
}
