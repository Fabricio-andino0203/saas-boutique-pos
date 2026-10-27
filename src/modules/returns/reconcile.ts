import type { PrismaClient } from "@/generated/prisma/client";

export type OverReturn = {
  saleItemId: string;
  sold: number;
  returned: number;
  /** Lo devuelto en dinero y lo que pagó el cliente por la línea. */
  refundedCents: number;
  paidCents: number;
};

/**
 * Invariante 3 de docs/DATA_MODEL.md §9: Σ ReturnItem.quantity ≤ SaleItem.quantity por línea, y nunca se reembolsa más de
 * lo que el cliente pagó por ella. Devuelve solo las líneas que se pasan; vacío significa que todo está bien.
 */
export async function findOverReturns(
  client: Pick<PrismaClient, "$queryRaw">,
): Promise<OverReturn[]> {
  return client.$queryRaw<OverReturn[]>`
    SELECT si."id" AS "saleItemId",
           si."quantity" AS "sold",
           SUM(ri."quantity")::int AS "returned",
           SUM(ri."refundCents")::int AS "refundedCents",
           si."lineTotalCents" AS "paidCents"
    FROM "SaleItem" si
    JOIN "ReturnItem" ri ON ri."saleItemId" = si."id"
    GROUP BY si."id", si."quantity", si."lineTotalCents"
    HAVING SUM(ri."quantity") > si."quantity" OR SUM(ri."refundCents") > si."lineTotalCents"
    ORDER BY 1
  `;
}
