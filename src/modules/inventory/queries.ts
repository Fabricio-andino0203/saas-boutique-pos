import { PRODUCT_LIMITS } from "@/config/constants";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { mulCents, sumCents } from "@/lib/money";
import { descendantsOf } from "@/modules/catalog/service";
import type {
  Kardex,
  KardexRow,
  StockCell,
  StockList,
  StockParams,
  StockRow,
  StockStatus,
} from "@/modules/inventory/types";
import { searchProductIds } from "@/modules/products/service";

export const KARDEX_PAGE_SIZE = 50;

/** Sin existencia (0 o menos), bajo (en su mínimo o menos) o normal. */
export function stockStatus(onHand: number, reorderPoint: number | null): StockStatus {
  if (onHand <= 0) {
    return "out";
  }
  return reorderPoint !== null && onHand <= reorderPoint ? "low" : "ok";
}

/**
 * Existencias por producto con su matriz talla × color, filtros y valoración (a costo y a precio de
 * venta; solo cuentan las existencias positivas). Trae todos los productos que coinciden con los filtros
 * de catálogo para poder filtrar por estado y totalizar; solo la página pedida lleva el detalle.
 */
export async function listStock(
  params: StockParams = {},
  client: PrismaClient = db,
): Promise<StockList> {
  const pageSize = PRODUCT_LIMITS.pageSize;
  const page = Math.max(1, Math.trunc(params.page ?? 1));
  const filter = params.filter ?? "all";
  const includeCost = params.includeCost ?? false;

  const where: Prisma.ProductWhereInput = {
    archivedAt: null,
    ...(params.seasonId ? { seasonId: params.seasonId } : {}),
  };
  if (params.categoryId) {
    const categories = await client.category.findMany({ select: { id: true, parentId: true } });
    where.categoryId = { in: [params.categoryId, ...descendantsOf(categories, params.categoryId)] };
  }
  if (params.q?.trim()) {
    where.id = { in: await searchProductIds(client, params.q) };
  }

  const products = await client.product.findMany({
    where,
    orderBy: [{ name: "asc" }, { code: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      basePriceCents: true,
      category: { select: { name: true } },
      variants: {
        where: { archivedAt: null },
        select: {
          id: true,
          sku: true,
          priceCents: true,
          avgCostCents: true,
          reorderPoint: true,
          size: { select: { name: true, sortOrder: true } },
          color: { select: { name: true, hex: true, sortOrder: true } },
          stockLevels: { select: { onHand: true, reserved: true } },
        },
      },
    },
  });

  const all: StockRow[] = products.map((product) => {
    const variants = [...product.variants].sort(
      (a, b) =>
        (a.size?.sortOrder ?? -1) - (b.size?.sortOrder ?? -1) ||
        (a.color?.sortOrder ?? -1) - (b.color?.sortOrder ?? -1) ||
        a.sku.localeCompare(b.sku),
    );
    const cells: StockCell[] = variants.map((variant) => {
      const onHand = variant.stockLevels.reduce((sum, level) => sum + level.onHand, 0);
      return {
        variantId: variant.id,
        sku: variant.sku,
        sizeName: variant.size?.name ?? null,
        colorName: variant.color?.name ?? null,
        colorHex: variant.color?.hex ?? null,
        onHand,
        reserved: variant.stockLevels.reduce((sum, level) => sum + level.reserved, 0),
        reorderPoint: variant.reorderPoint,
        status: stockStatus(onHand, variant.reorderPoint),
      };
    });
    const onHand = cells.reduce((sum, cell) => sum + cell.onHand, 0);
    const hasLowVariant = cells.some((cell) => cell.status !== "ok" && cell.reorderPoint !== null);
    return {
      productId: product.id,
      code: product.code,
      name: product.name,
      categoryName: product.category.name,
      variantCount: cells.length,
      onHand,
      status: onHand <= 0 ? "out" : hasLowVariant ? "low" : "ok",
      hasLowVariant,
      costValueCents: includeCost
        ? sumCents(
            variants.map((variant, index) =>
              mulCents(variant.avgCostCents, Math.max(cells[index]?.onHand ?? 0, 0)),
            ),
          )
        : null,
      priceValueCents: sumCents(
        variants.map((variant, index) =>
          mulCents(
            variant.priceCents ?? product.basePriceCents,
            Math.max(cells[index]?.onHand ?? 0, 0),
          ),
        ),
      ),
      cells,
    };
  });

  const kept = all.filter((row) => {
    switch (filter) {
      case "low":
        return row.hasLowVariant;
      case "out":
        return row.onHand <= 0;
      case "in":
        return row.onHand > 0;
      default:
        return true;
    }
  });

  return {
    rows: kept.slice((page - 1) * pageSize, page * pageSize),
    total: kept.length,
    page,
    pageSize,
    totals: {
      products: kept.length,
      units: kept.reduce((sum, row) => sum + Math.max(row.onHand, 0), 0),
      costValueCents: includeCost ? sumCents(kept.map((row) => row.costValueCents ?? 0)) : null,
      priceValueCents: sumCents(kept.map((row) => row.priceValueCents)),
    },
  };
}

type RawMovement = {
  id: string;
  createdAt: Date;
  type: KardexRow["type"];
  quantity: number;
  unitCostCents: number;
  reason: string | null;
  refType: string | null;
  refId: string | null;
  userName: string;
  locationName: string;
  balance: number;
};

/** Etiqueta y enlace del documento que originó un movimiento (cada tipo se resuelve en un solo viaje). */
async function resolveDocuments(
  client: PrismaClient,
  movements: Pick<RawMovement, "refType" | "refId">[],
): Promise<Map<string, { label: string; href: string | null }>> {
  const ids = (type: string) => [
    ...new Set(
      movements.filter((m) => m.refType === type && m.refId).map((m) => m.refId as string),
    ),
  ];
  const found = new Map<string, { label: string; href: string | null }>();

  const products = ids("Product");
  if (products.length > 0) {
    for (const row of await client.product.findMany({
      where: { id: { in: products } },
      select: { id: true, code: true },
    })) {
      found.set(`Product:${row.id}`, { label: row.code, href: `/productos/${row.id}` });
    }
  }
  const receipts = ids("GoodsReceipt");
  if (receipts.length > 0) {
    for (const row of await client.goodsReceipt.findMany({
      where: { id: { in: receipts } },
      select: { id: true, number: true },
    })) {
      found.set(`GoodsReceipt:${row.id}`, {
        label: row.number,
        href: `/compras/recepciones/${row.id}`,
      });
    }
  }
  const sales = ids("Sale");
  if (sales.length > 0) {
    for (const row of await client.sale.findMany({
      where: { id: { in: sales } },
      select: { id: true, number: true },
    })) {
      found.set(`Sale:${row.id}`, { label: row.number, href: `/ventas/${row.id}` });
    }
  }
  const returns = ids("ReturnDoc");
  if (returns.length > 0) {
    for (const row of await client.returnDoc.findMany({
      where: { id: { in: returns } },
      select: { id: true, number: true },
    })) {
      found.set(`ReturnDoc:${row.id}`, {
        label: row.number,
        href: `/imprimir/devolucion/${row.id}`,
      });
    }
  }
  const counts = ids("StockCount");
  if (counts.length > 0) {
    for (const row of await client.stockCount.findMany({
      where: { id: { in: counts } },
      select: { id: true },
    })) {
      found.set(`StockCount:${row.id}`, {
        label: row.id.slice(-6).toUpperCase(),
        href: `/inventario/conteos/${row.id}`,
      });
    }
  }
  return found;
}

/** Historial de movimientos de una variante, del más nuevo al más viejo, con el saldo tras cada uno. */
export async function getKardex(
  variantId: string,
  params: { page?: number } = {},
  client: PrismaClient = db,
): Promise<Kardex | null> {
  const variant = await client.variant.findUnique({
    where: { id: variantId },
    include: {
      product: { select: { id: true, name: true, code: true } },
      size: { select: { name: true } },
      color: { select: { name: true } },
      stockLevels: { select: { onHand: true } },
    },
  });
  if (!variant) {
    return null;
  }

  const page = Math.max(1, Math.trunc(params.page ?? 1));
  const total = await client.stockMovement.count({ where: { variantId } });
  const raw = await client.$queryRaw<RawMovement[]>`
    SELECT m."id", m."createdAt", m."type", m."quantity", m."unitCostCents", m."reason",
           m."refType", m."refId", u."name" AS "userName", l."name" AS "locationName",
           SUM(CASE WHEN m."type" IN ('LAYAWAY_RESERVE', 'LAYAWAY_RELEASE') THEN 0 ELSE m."quantity" END)
             OVER (ORDER BY m."createdAt", m."id")::int AS "balance"
    FROM "StockMovement" m
    JOIN "User" u ON u."id" = m."userId"
    JOIN "Location" l ON l."id" = m."locationId"
    WHERE m."variantId" = ${variantId}
    ORDER BY m."createdAt" DESC, m."id" DESC
    LIMIT ${KARDEX_PAGE_SIZE} OFFSET ${(page - 1) * KARDEX_PAGE_SIZE}
  `;
  const documents = await resolveDocuments(client, raw);

  return {
    header: {
      variantId,
      productId: variant.product.id,
      productName: variant.product.name,
      productCode: variant.product.code,
      sku: variant.sku,
      barcode: variant.barcode,
      sizeName: variant.size?.name ?? null,
      colorName: variant.color?.name ?? null,
      onHand: variant.stockLevels.reduce((sum, level) => sum + level.onHand, 0),
      avgCostCents: variant.avgCostCents,
    },
    rows: raw.map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      type: row.type,
      quantity: row.quantity,
      balance: row.balance,
      unitCostCents: row.unitCostCents,
      reason: row.reason,
      userName: row.userName,
      locationName: row.locationName,
      document:
        row.refType && row.refId
          ? (documents.get(`${row.refType}:${row.refId}`) ?? { label: row.refType, href: null })
          : null,
    })),
    total,
    page,
    pageSize: KARDEX_PAGE_SIZE,
  };
}
