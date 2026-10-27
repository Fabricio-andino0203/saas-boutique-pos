import type { PrismaClient } from "@/generated/prisma/client";

export type StockDiscrepancy = {
  variantId: string;
  locationId: string;
  movementSum: number;
  onHand: number;
};

/**
 * Invariante 1 de docs/DATA_MODEL.md §9: Σ StockMovement.quantity (sin reservas) = StockLevel.onHand.
 * Los movimientos de apartado cambian `reserved`, no `onHand`. Los `::int` evitan `bigint` en Prisma.
 * Devuelve solo las variantes y ubicaciones que no cuadran; vacío significa que todo está bien.
 */
export async function findStockDiscrepancies(
  client: Pick<PrismaClient, "$queryRaw">,
): Promise<StockDiscrepancy[]> {
  return client.$queryRaw<StockDiscrepancy[]>`
    SELECT COALESCE(m."variantId", l."variantId") AS "variantId",
           COALESCE(m."locationId", l."locationId") AS "locationId",
           COALESCE(m."movementSum", 0)::int AS "movementSum",
           COALESCE(l."onHand", 0)::int AS "onHand"
    FROM (
      SELECT "variantId", "locationId", SUM("quantity")::int AS "movementSum"
      FROM "StockMovement"
      WHERE "type" NOT IN ('LAYAWAY_RESERVE', 'LAYAWAY_RELEASE')
      GROUP BY "variantId", "locationId"
    ) m
    FULL OUTER JOIN "StockLevel" l
      ON l."variantId" = m."variantId" AND l."locationId" = m."locationId"
    WHERE COALESCE(m."movementSum", 0) <> COALESCE(l."onHand", 0)
    ORDER BY 1, 2
  `;
}

export type ReservedDiscrepancy = {
  variantId: string;
  locationId: string;
  movementSum: number;
  reserved: number;
};

/**
 * Σ de los movimientos de apartado (reservar suma, liberar resta) = StockLevel.reserved. Devuelve solo lo que no cuadra.
 */
export async function findReservedDiscrepancies(
  client: Pick<PrismaClient, "$queryRaw">,
): Promise<ReservedDiscrepancy[]> {
  return client.$queryRaw<ReservedDiscrepancy[]>`
    SELECT COALESCE(m."variantId", l."variantId") AS "variantId",
           COALESCE(m."locationId", l."locationId") AS "locationId",
           COALESCE(m."movementSum", 0)::int AS "movementSum",
           COALESCE(l."reserved", 0)::int AS "reserved"
    FROM (
      SELECT "variantId", "locationId", SUM("quantity")::int AS "movementSum"
      FROM "StockMovement"
      WHERE "type" IN ('LAYAWAY_RESERVE', 'LAYAWAY_RELEASE')
      GROUP BY "variantId", "locationId"
    ) m
    FULL OUTER JOIN "StockLevel" l
      ON l."variantId" = m."variantId" AND l."locationId" = m."locationId"
    WHERE COALESCE(m."movementSum", 0) <> COALESCE(l."reserved", 0)
    ORDER BY 1, 2
  `;
}
