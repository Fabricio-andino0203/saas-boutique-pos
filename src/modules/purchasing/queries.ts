import { PRODUCT_LIMITS } from "@/config/constants";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { PurchaseOrderStatus } from "@/generated/prisma/enums";
import { localDateKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { mulCents, sumCents } from "@/lib/money";
import { searchProductIds } from "@/modules/products/service";

export type VariantOption = {
  variantId: string;
  productName: string;
  label: string;
  sku: string;
  barcode: string;
  /** Costo promedio actual (solo si quien consulta puede ver costos). */
  costCents: number | null;
  /** Coincidió exactamente con el código de barras o el código que se escribió. */
  exact: boolean;
};

/** Una página de prendas: `hasMore` dice si hay más después de ella. */
export type VariantPage = { items: VariantOption[]; hasMore: boolean };

export const VARIANT_PAGE_SIZE = 40;

const label = (size?: { name: string } | null, color?: { name: string } | null): string =>
  [size?.name, color?.name].filter(Boolean).join(" · ");

/**
 * TODAS las prendas activas, por nombre y luego por código, de a páginas: para elegir mirando la lista en vez de tener que
 * adivinar qué escribir. `offset` es cuántas se saltan (0 = la primera página).
 */
export async function listVariantsPage(
  offset: number,
  options: { includeCost: boolean },
  client: PrismaClient = db,
): Promise<VariantPage> {
  const skip = Number.isInteger(offset) && offset > 0 ? Math.min(offset, 1_000_000) : 0;
  const variants = await client.variant.findMany({
    where: { archivedAt: null, product: { archivedAt: null } },
    include: {
      product: { select: { name: true, baseCostCents: true } },
      size: { select: { name: true } },
      color: { select: { name: true } },
    },
    orderBy: [{ product: { name: "asc" } }, { sku: "asc" }],
    skip,
    take: VARIANT_PAGE_SIZE + 1,
  });
  return {
    hasMore: variants.length > VARIANT_PAGE_SIZE,
    items: variants.slice(0, VARIANT_PAGE_SIZE).map((variant) => ({
      variantId: variant.id,
      productName: variant.product.name,
      label: label(variant.size, variant.color),
      sku: variant.sku,
      barcode: variant.barcode,
      costCents: options.includeCost
        ? variant.avgCostCents > 0
          ? variant.avgCostCents
          : variant.product.baseCostCents
        : null,
      exact: false,
    })),
  };
}

/** Prendas para el escáner y el buscador de compras: código de barras o código exacto primero, luego por nombre. */
export async function searchPurchasableVariants(
  query: string,
  options: { includeCost: boolean },
  client: PrismaClient = db,
): Promise<VariantOption[]> {
  const term = query.trim().slice(0, 100);
  if (term === "") {
    return [];
  }
  const include = {
    product: { select: { name: true, baseCostCents: true } },
    size: { select: { name: true } },
    color: { select: { name: true } },
  } satisfies Prisma.VariantInclude;
  const active = { archivedAt: null, product: { archivedAt: null } };

  const exact = await client.variant.findMany({
    where: {
      ...active,
      OR: [{ barcode: term }, { sku: { equals: term, mode: "insensitive" } }],
    },
    include,
    take: 5,
  });

  const toOption = (variant: (typeof exact)[number], isExact: boolean): VariantOption => ({
    variantId: variant.id,
    productName: variant.product.name,
    label: label(variant.size, variant.color),
    sku: variant.sku,
    barcode: variant.barcode,
    costCents: options.includeCost
      ? variant.avgCostCents > 0
        ? variant.avgCostCents
        : variant.product.baseCostCents
      : null,
    exact: isExact,
  });
  if (exact.length > 0) {
    return exact.map((variant) => toOption(variant, true));
  }

  const productIds = (await searchProductIds(client, term)).slice(0, 8);
  const variants = await client.variant.findMany({
    where: { ...active, productId: { in: productIds } },
    include,
    orderBy: [{ sku: "asc" }],
    take: 30,
  });
  const order = new Map(productIds.map((id, index) => [id, index]));
  return variants
    .sort((a, b) => (order.get(a.productId) ?? 0) - (order.get(b.productId) ?? 0))
    .map((variant) => toOption(variant, false));
}

// ───────────────────────── Órdenes ─────────────────────────

export type OrderRow = {
  id: string;
  number: string;
  supplierName: string;
  status: PurchaseOrderStatus;
  orderedUnits: number;
  receivedUnits: number;
  totalCostCents: number | null;
  createdAt: Date;
  expectedAt: string | null;
};

export type OrderList = { rows: OrderRow[]; total: number; page: number; pageSize: number };

export async function listPurchaseOrders(
  params: {
    status?: PurchaseOrderStatus;
    supplierId?: string;
    page?: number;
    includeCost: boolean;
  },
  client: PrismaClient = db,
): Promise<OrderList> {
  const pageSize = PRODUCT_LIMITS.pageSize;
  const page = Math.max(1, Math.trunc(params.page ?? 1));
  const where: Prisma.PurchaseOrderWhereInput = {
    ...(params.status ? { status: params.status } : {}),
    ...(params.supplierId ? { supplierId: params.supplierId } : {}),
  };
  const [total, orders] = await Promise.all([
    client.purchaseOrder.count({ where }),
    client.purchaseOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        supplier: { select: { name: true } },
        items: { select: { orderedQty: true, receivedQty: true, unitCostCents: true } },
      },
    }),
  ]);
  return {
    rows: orders.map((order) => ({
      id: order.id,
      number: order.number,
      supplierName: order.supplier.name,
      status: order.status,
      orderedUnits: order.items.reduce((sum, item) => sum + item.orderedQty, 0),
      receivedUnits: order.items.reduce((sum, item) => sum + item.receivedQty, 0),
      totalCostCents: params.includeCost
        ? sumCents(order.items.map((item) => mulCents(item.unitCostCents, item.orderedQty)))
        : null,
      createdAt: order.createdAt,
      expectedAt: order.expectedAt ? localDateKey(order.expectedAt) : null,
    })),
    total,
    page,
    pageSize,
  };
}

export type OrderLine = {
  itemId: string;
  variantId: string;
  productName: string;
  label: string;
  sku: string;
  orderedQty: number;
  receivedQty: number;
  unitCostCents: number | null;
};

export type OrderDetail = {
  id: string;
  number: string;
  supplierId: string;
  supplierName: string;
  status: PurchaseOrderStatus;
  expectedAt: string;
  notes: string;
  createdByName: string;
  createdAt: Date;
  totalCostCents: number | null;
  lines: OrderLine[];
  receipts: { id: string; number: string; receivedAt: Date; units: number }[];
};

export async function getPurchaseOrder(
  id: string,
  options: { includeCost: boolean },
  client: PrismaClient = db,
): Promise<OrderDetail | null> {
  const order = await client.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: { select: { name: true } },
      createdBy: { select: { name: true } },
      items: {
        include: {
          variant: {
            include: {
              product: { select: { name: true } },
              size: { select: { name: true } },
              color: { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
      receipts: {
        orderBy: { receivedAt: "desc" },
        include: { items: { select: { quantity: true } } },
      },
    },
  });
  if (!order) {
    return null;
  }
  return {
    id: order.id,
    number: order.number,
    supplierId: order.supplierId,
    supplierName: order.supplier.name,
    status: order.status,
    expectedAt: order.expectedAt ? localDateKey(order.expectedAt) : "",
    notes: order.notes ?? "",
    createdByName: order.createdBy.name,
    createdAt: order.createdAt,
    totalCostCents: options.includeCost
      ? sumCents(order.items.map((item) => mulCents(item.unitCostCents, item.orderedQty)))
      : null,
    lines: order.items.map((item) => ({
      itemId: item.id,
      variantId: item.variantId,
      productName: item.variant.product.name,
      label: label(item.variant.size, item.variant.color),
      sku: item.variant.sku,
      orderedQty: item.orderedQty,
      receivedQty: item.receivedQty,
      unitCostCents: options.includeCost ? item.unitCostCents : null,
    })),
    receipts: order.receipts.map((receipt) => ({
      id: receipt.id,
      number: receipt.number,
      receivedAt: receipt.receivedAt,
      units: receipt.items.reduce((sum, item) => sum + item.quantity, 0),
    })),
  };
}

// ───────────────────────── Recepciones ─────────────────────────

export type ReceiptRow = {
  id: string;
  number: string;
  receivedAt: Date;
  supplierName: string;
  supplierInvoiceRef: string;
  orderNumber: string | null;
  receivedByName: string;
  units: number;
  totalCostCents: number | null;
};

export type ReceiptList = {
  rows: ReceiptRow[];
  total: number;
  page: number;
  pageSize: number;
  /** De todo lo que coincide con el filtro (no solo de la página). */
  totals: { units: number; costCents: number | null };
};

export async function listReceipts(
  params: { supplierId?: string; page?: number; includeCost: boolean },
  client: PrismaClient = db,
): Promise<ReceiptList> {
  const pageSize = PRODUCT_LIMITS.pageSize;
  const page = Math.max(1, Math.trunc(params.page ?? 1));
  const where: Prisma.GoodsReceiptWhereInput = params.supplierId
    ? { supplierId: params.supplierId }
    : {};
  const include = {
    supplier: { select: { name: true } },
    receivedBy: { select: { name: true } },
    purchaseOrder: { select: { number: true } },
    items: { select: { quantity: true, unitCostCents: true } },
  } satisfies Prisma.GoodsReceiptInclude;

  const [total, receipts, everything] = await Promise.all([
    client.goodsReceipt.count({ where }),
    client.goodsReceipt.findMany({
      where,
      orderBy: { receivedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include,
    }),
    client.goodsReceiptItem.findMany({
      where: { goodsReceipt: where },
      select: { quantity: true, unitCostCents: true },
    }),
  ]);
  const costOf = (items: { quantity: number; unitCostCents: number }[]) =>
    sumCents(items.map((item) => mulCents(item.unitCostCents, item.quantity)));

  return {
    rows: receipts.map((receipt) => ({
      id: receipt.id,
      number: receipt.number,
      receivedAt: receipt.receivedAt,
      supplierName: receipt.supplier.name,
      supplierInvoiceRef: receipt.supplierInvoiceRef ?? "",
      orderNumber: receipt.purchaseOrder?.number ?? null,
      receivedByName: receipt.receivedBy.name,
      units: receipt.items.reduce((sum, item) => sum + item.quantity, 0),
      totalCostCents: params.includeCost ? costOf(receipt.items) : null,
    })),
    total,
    page,
    pageSize,
    totals: {
      units: everything.reduce((sum, item) => sum + item.quantity, 0),
      costCents: params.includeCost ? costOf(everything) : null,
    },
  };
}

export type ReceiptDetail = {
  id: string;
  number: string;
  receivedAt: Date;
  supplierId: string;
  supplierName: string;
  supplierInvoiceRef: string;
  order: { id: string; number: string } | null;
  receivedByName: string;
  units: number;
  totalCostCents: number | null;
  lines: {
    variantId: string;
    productName: string;
    label: string;
    sku: string;
    quantity: number;
    unitCostCents: number | null;
  }[];
};

export async function getReceipt(
  id: string,
  options: { includeCost: boolean },
  client: PrismaClient = db,
): Promise<ReceiptDetail | null> {
  const receipt = await client.goodsReceipt.findUnique({
    where: { id },
    include: {
      supplier: { select: { name: true } },
      receivedBy: { select: { name: true } },
      purchaseOrder: { select: { id: true, number: true } },
      items: {
        include: {
          variant: {
            include: {
              product: { select: { name: true } },
              size: { select: { name: true } },
              color: { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!receipt) {
    return null;
  }
  return {
    id: receipt.id,
    number: receipt.number,
    receivedAt: receipt.receivedAt,
    supplierId: receipt.supplierId,
    supplierName: receipt.supplier.name,
    supplierInvoiceRef: receipt.supplierInvoiceRef ?? "",
    order: receipt.purchaseOrder,
    receivedByName: receipt.receivedBy.name,
    units: receipt.items.reduce((sum, item) => sum + item.quantity, 0),
    totalCostCents: options.includeCost
      ? sumCents(receipt.items.map((item) => mulCents(item.unitCostCents, item.quantity)))
      : null,
    lines: receipt.items.map((item) => ({
      variantId: item.variantId,
      productName: item.variant.product.name,
      label: label(item.variant.size, item.variant.color),
      sku: item.variant.sku,
      quantity: item.quantity,
      unitCostCents: options.includeCost ? item.unitCostCents : null,
    })),
  };
}

/** Proveedores activos para los selectores de compras. */
export async function listSupplierOptions(
  client: Pick<PrismaClient, "supplier"> = db,
): Promise<{ value: string; label: string }[]> {
  const suppliers = await client.supplier.findMany({
    where: { archivedAt: null },
    orderBy: { name: "asc" },
  });
  return suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }));
}
