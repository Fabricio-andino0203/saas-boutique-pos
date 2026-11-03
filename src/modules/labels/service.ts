import type { PrismaClient } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { barcodeSvg } from "@/lib/barcode-svg";
import { db } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { requireCapability } from "@/lib/permissions";
import { getSetting, LABEL_TEMPLATE_SCHEMA, setSetting, type LabelTemplate } from "@/lib/settings";
import type { Actor } from "@/modules/catalog/service";
import { listProducts } from "@/modules/products/service";
import type { VariantOption } from "@/modules/purchasing/queries";

/** Tope de etiquetas por impresión: protege la página y el papel de un error de tecleo. */
export const MAX_LABELS = 1000;

export type LabelItem = { variantId: string; quantity: number };

export type LabelData = {
  variantId: string;
  productName: string;
  variantLabel: string;
  sku: string;
  priceCents: number;
  barcode: string;
  svg: string;
};

export async function getLabelTemplate(
  client: Pick<PrismaClient, "setting"> = db,
): Promise<LabelTemplate> {
  return getSetting(client, "labels.template");
}

export async function saveLabelTemplate(
  actor: Actor,
  input: unknown,
  client: PrismaClient = db,
): Promise<LabelTemplate> {
  requireCapability(actor, "stock.adjust");
  const parsed = LABEL_TEMPLATE_SCHEMA.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid template");
  }
  await client.$transaction(async (tx) => {
    const before = await getSetting(tx, "labels.template");
    await setSetting(tx, "labels.template", parsed.data);
    if (JSON.stringify(before) !== JSON.stringify(parsed.data)) {
      await audit.log(tx, {
        userId: actor.id,
        action: "SETTINGS_CHANGED",
        entityType: "Setting",
        entityId: "labels.template",
        before,
        after: parsed.data,
      });
    }
  });
  return parsed.data;
}

/**
 * Las etiquetas por imprimir: una por cada unidad pedida de cada variante, con su precio vigente y su
 * código de barras como SVG. Rechaza cantidades inválidas, prendas que no existen y pedidos enormes.
 */
export async function buildLabels(
  items: LabelItem[],
  client: PrismaClient = db,
): Promise<LabelData[]> {
  const total = items.reduce((sum, item) => sum + item.quantity, 0);
  if (
    items.length === 0 ||
    items.some((item) => !Number.isInteger(item.quantity) || item.quantity < 1) ||
    total > MAX_LABELS
  ) {
    throw new ValidationError("Invalid label quantities");
  }
  const variants = await client.variant.findMany({
    where: { id: { in: items.map((item) => item.variantId) } },
    select: {
      id: true,
      sku: true,
      barcode: true,
      priceCents: true,
      product: { select: { name: true, basePriceCents: true } },
      size: { select: { name: true } },
      color: { select: { name: true } },
    },
  });
  const byId = new Map(variants.map((variant) => [variant.id, variant]));

  const labels: LabelData[] = [];
  for (const item of items) {
    const variant = byId.get(item.variantId);
    if (!variant) {
      throw new ValidationError("Unknown variant");
    }
    const data: LabelData = {
      variantId: variant.id,
      productName: variant.product.name,
      variantLabel: [variant.size?.name, variant.color?.name].filter(Boolean).join(" · "),
      sku: variant.sku,
      priceCents: variant.priceCents ?? variant.product.basePriceCents,
      barcode: variant.barcode,
      svg: barcodeSvg(variant.barcode),
    };
    for (let copy = 0; copy < item.quantity; copy += 1) {
      labels.push(data);
    }
  }
  return labels;
}

export type SelectionRow = {
  variantId: string;
  productName: string;
  label: string;
  sku: string;
  /** Cuántas etiquetas arrancan pedidas (la cantidad se puede cambiar en la pantalla). */
  quantity: number;
  /** Cuántas unidades hay ahora (en todas las ubicaciones). */
  onHand: number;
};

/**
 * Cuántas etiquetas pedir al elegir las prendas de un producto: **una de cada** prenda o **las que hay en stock**. Es una
 * comodidad opcional: la cantidad siempre se puede cambiar antes de imprimir.
 */
export type LabelQuantityMode = "one" | "stock";

export const isLabelQuantityMode = (value: string): value is LabelQuantityMode =>
  value === "one" || value === "stock";

/** Las unidades que hay de cada prenda, sumando todas las ubicaciones; una prenda sin movimientos vale 0. */
export async function stockByVariant(
  variantIds: readonly string[],
  client: PrismaClient = db,
): Promise<Map<string, number>> {
  if (variantIds.length === 0) {
    return new Map();
  }
  const rows = await client.stockLevel.groupBy({
    by: ["variantId"],
    where: { variantId: { in: [...variantIds] } },
    _sum: { onHand: true },
  });
  return new Map(rows.map((row) => [row.variantId, row._sum.onHand ?? 0]));
}

/** Las opciones del buscador de prendas con su stock, para que se vea cuántas hay antes de pedir etiquetas. */
export async function withStock(
  options: readonly VariantOption[],
  client: PrismaClient = db,
): Promise<(VariantOption & { onHand: number })[]> {
  const stock = await stockByVariant(
    options.map((option) => option.variantId),
    client,
  );
  return options.map((option) => ({ ...option, onHand: stock.get(option.variantId) ?? 0 }));
}

const quantityFor = (mode: LabelQuantityMode, onHand: number): number =>
  mode === "stock" ? Math.max(0, onHand) : 1;

/** Prendas con las que arranca la pantalla de etiquetas: las de uno o varios productos, o las de una recepción. */
export async function getLabelSelection(
  params: { productIds?: string[]; receiptId?: string; quantity?: LabelQuantityMode },
  client: PrismaClient = db,
): Promise<SelectionRow[]> {
  const include = {
    product: { select: { name: true } },
    size: { select: { name: true } },
    color: { select: { name: true } },
  } as const;

  if (params.receiptId) {
    const items = await client.goodsReceiptItem.findMany({
      where: { goodsReceiptId: params.receiptId },
      include: { variant: { include } },
      orderBy: { createdAt: "asc" },
    });
    const stock = await stockByVariant(
      items.map((item) => item.variantId),
      client,
    );
    return items.map((item) => ({
      variantId: item.variantId,
      productName: item.variant.product.name,
      label: [item.variant.size?.name, item.variant.color?.name].filter(Boolean).join(" · "),
      sku: item.variant.sku,
      quantity: item.quantity,
      onHand: stock.get(item.variantId) ?? 0,
    }));
  }
  if (params.productIds && params.productIds.length > 0) {
    const variants = await client.variant.findMany({
      where: { productId: { in: params.productIds.slice(0, 200) }, archivedAt: null },
      include,
      orderBy: [{ product: { name: "asc" } }, { sku: "asc" }],
    });
    const stock = await stockByVariant(
      variants.map((variant) => variant.id),
      client,
    );
    return variants.map((variant) => {
      const onHand = stock.get(variant.id) ?? 0;
      return {
        variantId: variant.id,
        productName: variant.product.name,
        label: [variant.size?.name, variant.color?.name].filter(Boolean).join(" · "),
        sku: variant.sku,
        quantity: quantityFor(params.quantity ?? "one", onHand),
        onHand,
      };
    });
  }
  return [];
}

export type LabelProductOption = {
  id: string;
  code: string;
  name: string;
  variantCount: number;
  onHand: number;
  imageId: string | null;
};

/** Productos activos que coinciden con lo escrito (nombre, código o código de barras), para elegir uno y sacar todas sus prendas. */
export async function searchLabelProducts(
  query: string,
  client: PrismaClient = db,
): Promise<LabelProductOption[]> {
  const term = query.trim();
  if (term === "") {
    return [];
  }
  const { rows } = await listProducts({ q: term, status: "active", page: 1 }, client);
  return rows
    .filter((row) => row.variantCount > 0)
    .map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      variantCount: row.variantCount,
      onHand: row.onHand,
      imageId: row.coverImageId,
    }));
}

/** Todas las prendas de un producto, con la cantidad de etiquetas que pide el modo elegido. */
export async function getProductLabelRows(
  productId: string,
  quantity: LabelQuantityMode,
  client: PrismaClient = db,
): Promise<SelectionRow[]> {
  return getLabelSelection({ productIds: [productId], quantity }, client);
}
