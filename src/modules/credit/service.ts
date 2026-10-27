import type { Prisma } from "@/generated/prisma/client";
import type { StoreCreditReason } from "@/generated/prisma/enums";
import { InsufficientCreditError, NotFoundError, ValidationError } from "@/lib/errors";

type Tx = Prisma.TransactionClient;

export type StoreCreditMovement = {
  customerId: string;
  /** Con signo: positivo abona crédito, negativo lo consume. Nunca cero. */
  amountCents: number;
  reason: StoreCreditReason;
  refType: string;
  refId: string;
  userId: string;
  /** El motivo, en los ajustes manuales. */
  note?: string;
};

/**
 * Única puerta para cambiar el crédito de tienda de un cliente: escribe el movimiento en el libro (solo inserción) y
 * deja `Customer.storeCreditCents` igual a la suma del libro, en la misma transacción (invariante #5). La fila del
 * cliente se bloquea mientras tanto, así dos cobros con el mismo crédito no lo gastan dos veces. El saldo no puede
 * quedar negativo.
 */
export async function applyStoreCredit(
  tx: Tx,
  movement: StoreCreditMovement,
): Promise<{ balanceCents: number }> {
  if (!Number.isSafeInteger(movement.amountCents) || movement.amountCents === 0) {
    throw new ValidationError("A store credit movement needs a non-zero whole amount");
  }
  const [customer] = await tx.$queryRaw<{ storeCreditCents: number }[]>`
    SELECT "storeCreditCents" FROM "Customer" WHERE "id" = ${movement.customerId} FOR UPDATE
  `;
  if (!customer) {
    throw new NotFoundError("Customer not found");
  }
  const balanceCents = customer.storeCreditCents + movement.amountCents;
  if (balanceCents < 0) {
    throw new InsufficientCreditError();
  }
  await tx.storeCreditEntry.create({
    data: {
      customerId: movement.customerId,
      amountCents: movement.amountCents,
      reason: movement.reason,
      refType: movement.refType,
      refId: movement.refId,
      note: movement.note,
      userId: movement.userId,
    },
  });
  await tx.customer.update({
    where: { id: movement.customerId },
    data: { storeCreditCents: balanceCents },
  });
  return { balanceCents };
}
