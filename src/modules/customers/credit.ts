import type { PrismaClient } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { requireCapability } from "@/lib/permissions";
import type { Actor } from "@/modules/catalog/service";
import { applyStoreCredit } from "@/modules/credit/service";
import { adjustCreditSchema } from "@/modules/customers/schemas";

export type AdjustedCredit = {
  balanceCents: number;
  /** `true` si ese ajuste ya estaba registrado con el mismo identificador y no se hizo nada nuevo. */
  replayed: boolean;
};

/**
 * Suma o resta crédito de tienda a mano (un error de captura, una cortesía). Pide el permiso `credit.adjust` y un
 * motivo; el movimiento queda en el libro con ese motivo y en la auditoría con el saldo de antes y de después. El
 * saldo nunca queda negativo. Reintentar con el mismo `requestId` no ajusta dos veces.
 */
export async function adjustStoreCredit(
  actor: Actor,
  input: unknown,
  client: PrismaClient = db,
): Promise<AdjustedCredit> {
  requireCapability(actor, "credit.adjust");
  const parsed = adjustCreditSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const data = parsed.data;
  const signed = data.direction === "ADD" ? data.amountCents : -data.amountCents;

  return client.$transaction(
    async (tx) => {
      // El cliente se bloquea primero: dos envíos a la vez del mismo ajuste se ordenan y el segundo ve al primero.
      const [customer] = await tx.$queryRaw<{ storeCreditCents: number }[]>`
        SELECT "storeCreditCents" FROM "Customer" WHERE "id" = ${data.customerId} FOR UPDATE
      `;
      if (!customer) {
        throw new NotFoundError("Customer not found");
      }
      const already = await tx.storeCreditEntry.findFirst({
        where: { customerId: data.customerId, refType: "Adjustment", refId: data.requestId },
        select: { id: true },
      });
      if (already) {
        return { balanceCents: customer.storeCreditCents, replayed: true };
      }
      const { balanceCents } = await applyStoreCredit(tx, {
        customerId: data.customerId,
        amountCents: signed,
        reason: "MANUAL",
        refType: "Adjustment",
        refId: data.requestId,
        userId: actor.id,
        note: data.reason,
      });
      await audit.log(tx, {
        userId: actor.id,
        action: "STORE_CREDIT_ADJUSTED",
        entityType: "Customer",
        entityId: data.customerId,
        before: { storeCreditCents: customer.storeCreditCents },
        after: { storeCreditCents: balanceCents, amountCents: signed },
        reason: data.reason,
      });
      return { balanceCents, replayed: false };
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
}
