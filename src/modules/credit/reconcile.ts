import type { PrismaClient } from "@/generated/prisma/client";

export type CreditDiscrepancy = {
  customerId: string;
  cachedCents: number;
  ledgerCents: number;
};

/**
 * Invariante 5 de docs/DATA_MODEL.md §9: Customer.storeCreditCents = Σ StoreCreditEntry.amountCents, y nunca es negativo.
 * Devuelve solo los clientes que no cuadran; vacío significa que todo está bien.
 */
export async function findCreditDiscrepancies(
  client: Pick<PrismaClient, "$queryRaw">,
): Promise<CreditDiscrepancy[]> {
  return client.$queryRaw<CreditDiscrepancy[]>`
    SELECT c."id" AS "customerId",
           c."storeCreditCents" AS "cachedCents",
           COALESCE(SUM(e."amountCents"), 0)::int AS "ledgerCents"
    FROM "Customer" c
    LEFT JOIN "StoreCreditEntry" e ON e."customerId" = c."id"
    GROUP BY c."id", c."storeCreditCents"
    HAVING c."storeCreditCents" <> COALESCE(SUM(e."amountCents"), 0) OR c."storeCreditCents" < 0
    ORDER BY 1
  `;
}
