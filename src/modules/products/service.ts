import type { z } from "zod";

import { PRODUCT_LIMITS } from "@/config/constants";
import { messages } from "@/config/messages.es";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { buildEan13 } from "@/lib/barcode";
import { db } from "@/lib/db";
import { assertWithinPlanLimit } from "@/lib/entitlements";
import { CodeTakenError, HasStockError, NotFoundError, ValidationError } from "@/lib/errors";
import { percentOf } from "@/lib/money";
import { requireCapability } from "@/lib/permissions";
import { getSetting } from "@/lib/settings";
import { createItem, descendantsOf, type Actor } from "@/modules/catalog/service";
import { getDefaultLocationId, recordMovement } from "@/modules/inventory/service";
import {
  addVariantsSchema,
  bulkEditSchema,
  createProductSchema,
  productFieldsSchema,
  quickOptionSchema,
  variantUpdateSchema,
  type BulkEditInput,
  type ProductFieldsInput,
} from "@/modules/products/schemas";
import { buildSkuBase, cellKey, uniqueSku } from "@/modules/products/sku";
import type {
  Option,
  PriceHistoryRow,
  ProductDetail,
  ProductFormOptions,
  ProductList,
  ProductListParams,
  ProductRow,
  VariantRow,
} from "@/modules/products/types";

type Tx = Prisma.TransactionClient;

function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(result.error.issues[0]?.message ?? "Invalid input");
  }
  return result.data;
}

function dbErrorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

// ───────────────────────── Códigos ─────────────────────────

async function nextSerials(
  tx: Pick<Tx, "$queryRaw">,
  sequence: "product_code_seq" | "barcode_serial_seq",
  count: number,
): Promise<number[]> {
  if (count <= 0) {
    return [];
  }
  const rows = await tx.$queryRaw<{ n: bigint }[]>`
    SELECT nextval(${Prisma.raw(`'${sequence}'`)}) AS n FROM generate_series(1, ${count}::int)
  `;
  return rows.map((row) => Number(row.n));
}

export async function freshProductCode(tx: Tx): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const [serial = 0] = await nextSerials(tx, "product_code_seq", 1);
    const code = `P${String(serial).padStart(5, "0")}`;
    if (!(await tx.product.findUnique({ where: { code }, select: { id: true } }))) {
      return code;
    }
  }
  throw new ValidationError("Could not allocate a product code");
}

// ───────────────────────── Referencias ─────────────────────────

async function assertReferences(tx: Tx, data: ProductFieldsInput): Promise<void> {
  const active = { archivedAt: null };
  const checks: [boolean, string][] = [
    [(await tx.category.count({ where: { id: data.categoryId, ...active } })) === 1, "category"],
    [
      !data.brandId || (await tx.brand.count({ where: { id: data.brandId, ...active } })) === 1,
      "brand",
    ],
    [
      !data.seasonId || (await tx.season.count({ where: { id: data.seasonId, ...active } })) === 1,
      "season",
    ],
    [
      !data.supplierId ||
        (await tx.supplier.count({ where: { id: data.supplierId, ...active } })) === 1,
      "supplier",
    ],
  ];
  const missing = checks.find(([found]) => !found);
  if (missing) {
    throw new ValidationError(`Unknown or archived ${missing[1]}`);
  }
}

// ───────────────────────── Variantes ─────────────────────────

export type Named = { id: string; name: string };

async function loadActive(tx: Tx, entity: "size" | "color", ids: string[]): Promise<Named[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) {
    return [];
  }
  const where = { id: { in: unique }, archivedAt: null };
  const orderBy = [{ sortOrder: "asc" as const }, { name: "asc" as const }];
  const found: Named[] =
    entity === "size"
      ? await tx.size.findMany({ where, orderBy })
      : await tx.color.findMany({ where, orderBy });
  if (found.length !== unique.length) {
    throw new ValidationError(`Unknown or archived ${entity}`);
  }
  return found;
}

/** Una celda de la matriz: una variante por crear, con su existencia inicial y, si viene de fuera, su código de barras. */
export type VariantCell = {
  size: Named | null;
  color: Named | null;
  quantity: number;
  barcode?: string;
};

type NewVariantCells = {
  product: { id: string; code: string; baseCostCents: number };
  cells: VariantCell[];
  actor: Actor;
};

/** Crea variantes con SKU único, código de barras (el dado o uno interno) y su existencia inicial. */
export async function createVariantCells(tx: Tx, input: NewVariantCells): Promise<number> {
  const { product, cells, actor } = input;
  if (cells.length === 0) {
    return 0;
  }

  const taken = new Set(
    (
      await tx.variant.findMany({
        where: { sku: { startsWith: product.code } },
        select: { sku: true },
      })
    ).map((row) => row.sku),
  );
  const prefix = await getSetting(tx, "barcode.internalPrefix");
  const serials = await nextSerials(
    tx,
    "barcode_serial_seq",
    cells.filter((cell) => !cell.barcode).length,
  );

  const created = await tx.variant.createManyAndReturn({
    data: cells.map(({ size, color, barcode }) => ({
      productId: product.id,
      sizeId: size?.id ?? null,
      colorId: color?.id ?? null,
      sku: uniqueSku(buildSkuBase(product.code, size?.name, color?.name), taken),
      barcode: barcode ?? buildEan13(prefix, serials.shift() ?? 0),
      avgCostCents: product.baseCostCents,
    })),
    select: { id: true, sizeId: true, colorId: true },
  });

  const quantityOf = new Map(
    cells.map((cell) => [cellKey(cell.size?.id ?? null, cell.color?.id ?? null), cell.quantity]),
  );
  const withStock = created
    .map((variant) => ({
      variant,
      quantity: quantityOf.get(cellKey(variant.sizeId, variant.colorId)) ?? 0,
    }))
    .filter((entry) => entry.quantity > 0);
  if (withStock.length > 0) {
    const locationId = await getDefaultLocationId(tx);
    for (const { variant, quantity } of withStock) {
      await recordMovement(tx, {
        variantId: variant.id,
        locationId,
        type: "INITIAL",
        quantity,
        unitCostCents: product.baseCostCents,
        userId: actor.id,
        reason: "Existencia inicial",
        refType: "Product",
        refId: product.id,
      });
    }
  }
  return created.length;
}

type NewVariantSource = {
  product: { id: string; code: string; baseCostCents: number };
  sizes: Named[];
  colors: Named[];
  quantities: Record<string, number>;
  /** Combinaciones que ya existen (se omiten). */
  skip?: Set<string>;
  actor: Actor;
};

/** La matriz talla × color completa (sin talla o sin color queda una sola fila o columna). */
async function createVariants(tx: Tx, source: NewVariantSource): Promise<number> {
  const sizes: (Named | null)[] = source.sizes.length > 0 ? source.sizes : [null];
  const colors: (Named | null)[] = source.colors.length > 0 ? source.colors : [null];
  const cells = sizes
    .flatMap((size) => colors.map((color) => ({ size, color })))
    .filter(({ size, color }) => !source.skip?.has(cellKey(size?.id ?? null, color?.id ?? null)))
    .map(({ size, color }) => ({
      size,
      color,
      quantity: source.quantities[cellKey(size?.id ?? null, color?.id ?? null)] ?? 0,
    }));
  return createVariantCells(tx, { product: source.product, cells, actor: source.actor });
}

// ───────────────────────── Crear ─────────────────────────

/** El plan del negocio puede limitar cuántos productos activos tiene; `adding` es cuántos se van a crear. */
export async function assertProductRoom(tx: Tx, adding = 1): Promise<void> {
  await assertWithinPlanLimit(
    "products",
    () => tx.product.count({ where: { archivedAt: null } }),
    adding,
  );
}

export async function createProductTx(
  tx: Tx,
  actor: Actor,
  input: unknown,
): Promise<{ id: string; code: string }> {
  requireCapability(actor, "product.write");
  const data = parseInput(createProductSchema, input);
  await assertReferences(tx, data);
  const [sizes, colors] = await Promise.all([
    loadActive(tx, "size", data.sizeIds),
    loadActive(tx, "color", data.colorIds),
  ]);
  await assertProductRoom(tx);
  const code = data.code ?? (await freshProductCode(tx));

  let product;
  try {
    product = await tx.product.create({
      data: {
        code,
        name: data.name,
        description: data.description ?? null,
        categoryId: data.categoryId,
        brandId: data.brandId ?? null,
        seasonId: data.seasonId ?? null,
        defaultSupplierId: data.supplierId ?? null,
        basePriceCents: data.basePriceCents,
        baseCostCents: data.baseCostCents,
        taxCategory: data.taxCategory,
      },
    });
  } catch (error) {
    throw dbErrorCode(error) === "P2002" ? new CodeTakenError() : error;
  }

  const variantCount = await createVariants(tx, {
    product,
    sizes,
    colors,
    quantities: data.quantities,
    actor,
  });
  await audit.log(tx, {
    userId: actor.id,
    action: "PRODUCT_CREATED",
    entityType: "Product",
    entityId: product.id,
    after: {
      code,
      name: data.name,
      basePriceCents: data.basePriceCents,
      baseCostCents: data.baseCostCents,
      variants: variantCount,
    },
  });
  return { id: product.id, code };
}

export async function createProduct(
  actor: Actor,
  input: unknown,
  client: PrismaClient = db,
): Promise<{ id: string; code: string }> {
  requireCapability(actor, "product.write");
  return client.$transaction((tx) => createProductTx(tx, actor, input));
}

// ───────────────────────── Editar ─────────────────────────

export async function updateProduct(
  actor: Actor,
  id: string,
  input: unknown,
  client: PrismaClient = db,
): Promise<void> {
  requireCapability(actor, "product.write");
  const data = parseInput(productFieldsSchema, input);
  await client.$transaction(async (tx) => {
    const before = await tx.product.findUnique({ where: { id } });
    if (!before) {
      throw new NotFoundError();
    }
    const priceChanged = before.basePriceCents !== data.basePriceCents;
    const costChanged = before.baseCostCents !== data.baseCostCents;
    if (priceChanged || costChanged) {
      requireCapability(actor, "price.change");
    }
    await assertReferences(tx, data);

    const next = {
      name: data.name,
      description: data.description ?? null,
      categoryId: data.categoryId,
      brandId: data.brandId ?? null,
      seasonId: data.seasonId ?? null,
      defaultSupplierId: data.supplierId ?? null,
      taxCategory: data.taxCategory,
    };
    const otherChanges = (Object.keys(next) as (keyof typeof next)[]).filter(
      (key) => before[key] !== next[key],
    );
    await tx.product.update({
      where: { id },
      data: { ...next, basePriceCents: data.basePriceCents, baseCostCents: data.baseCostCents },
    });

    if (priceChanged || costChanged) {
      await tx.priceHistory.create({
        data: {
          productId: id,
          oldPriceCents: before.basePriceCents,
          newPriceCents: data.basePriceCents,
          oldCostCents: before.baseCostCents,
          newCostCents: data.baseCostCents,
          changedById: actor.id,
        },
      });
    }
    if (priceChanged) {
      await audit.log(tx, {
        userId: actor.id,
        action: "PRICE_CHANGED",
        entityType: "Product",
        entityId: id,
        before: { basePriceCents: before.basePriceCents },
        after: { basePriceCents: data.basePriceCents },
      });
    }
    if (costChanged) {
      await audit.log(tx, {
        userId: actor.id,
        action: "COST_CHANGED",
        entityType: "Product",
        entityId: id,
        before: { baseCostCents: before.baseCostCents },
        after: { baseCostCents: data.baseCostCents },
      });
    }
    if (otherChanges.length > 0) {
      await audit.log(tx, {
        userId: actor.id,
        action: "PRODUCT_UPDATED",
        entityType: "Product",
        entityId: id,
        before: Object.fromEntries(otherChanges.map((key) => [key, before[key]])),
        after: Object.fromEntries(otherChanges.map((key) => [key, next[key]])),
      });
    }
  });
}

export async function updateVariant(
  actor: Actor,
  variantId: string,
  input: unknown,
  client: PrismaClient = db,
): Promise<void> {
  requireCapability(actor, "product.write");
  const data = parseInput(variantUpdateSchema, input);
  await client.$transaction(async (tx) => {
    const before = await tx.variant.findUnique({
      where: { id: variantId },
      include: { product: { select: { basePriceCents: true, baseCostCents: true } } },
    });
    if (!before) {
      throw new NotFoundError();
    }
    const priceChanged = before.priceCents !== data.priceCents;
    const costChanged = before.costCents !== data.costCents;
    if (priceChanged || costChanged) {
      requireCapability(actor, "price.change");
    }
    await tx.variant.update({
      where: { id: variantId },
      data: {
        priceCents: data.priceCents,
        costCents: data.costCents,
        reorderPoint: data.reorderPoint,
      },
    });
    if (priceChanged || costChanged) {
      const { basePriceCents, baseCostCents } = before.product;
      await tx.priceHistory.create({
        data: {
          variantId,
          oldPriceCents: before.priceCents ?? basePriceCents,
          newPriceCents: data.priceCents ?? basePriceCents,
          oldCostCents: before.costCents ?? baseCostCents,
          newCostCents: data.costCents ?? baseCostCents,
          changedById: actor.id,
        },
      });
    }
    if (priceChanged) {
      await audit.log(tx, {
        userId: actor.id,
        action: "PRICE_CHANGED",
        entityType: "Variant",
        entityId: variantId,
        before: { priceCents: before.priceCents },
        after: { priceCents: data.priceCents },
      });
    }
    if (costChanged) {
      await audit.log(tx, {
        userId: actor.id,
        action: "COST_CHANGED",
        entityType: "Variant",
        entityId: variantId,
        before: { costCents: before.costCents },
        after: { costCents: data.costCents },
      });
    }
  });
}

/** Agrega tallas y colores a un producto existente; restaura las combinaciones archivadas. */
export async function addVariants(
  actor: Actor,
  productId: string,
  input: unknown,
  client: PrismaClient = db,
): Promise<{ created: number; restored: number }> {
  requireCapability(actor, "product.write");
  const data = parseInput(addVariantsSchema, input);
  return client.$transaction(async (tx) => {
    const product = await tx.product.findUnique({ where: { id: productId } });
    if (!product || product.archivedAt) {
      throw new NotFoundError();
    }
    const [sizes, colors] = await Promise.all([
      loadActive(tx, "size", data.sizeIds),
      loadActive(tx, "color", data.colorIds),
    ]);
    const existing = await tx.variant.findMany({
      where: { productId },
      select: { id: true, sizeId: true, colorId: true, archivedAt: true },
    });
    const wanted = new Set(
      (sizes.length > 0 ? sizes : [null]).flatMap((size) =>
        (colors.length > 0 ? colors : [null]).map((color) =>
          cellKey(size?.id ?? null, color?.id ?? null),
        ),
      ),
    );
    const archivedToRestore = existing.filter(
      (variant) => variant.archivedAt && wanted.has(cellKey(variant.sizeId, variant.colorId)),
    );
    if (archivedToRestore.length > 0) {
      await tx.variant.updateMany({
        where: { id: { in: archivedToRestore.map((variant) => variant.id) } },
        data: { archivedAt: null },
      });
    }
    const created = await createVariants(tx, {
      product,
      sizes,
      colors,
      quantities: data.quantities,
      skip: new Set(existing.map((variant) => cellKey(variant.sizeId, variant.colorId))),
      actor,
    });
    return { created, restored: archivedToRestore.length };
  });
}

// ───────────────────────── Archivar ─────────────────────────

async function onHandOf(tx: Tx, where: Prisma.StockLevelWhereInput): Promise<number> {
  const sum = await tx.stockLevel.aggregate({ where, _sum: { onHand: true } });
  return sum._sum.onHand ?? 0;
}

export async function setProductArchived(
  actor: Actor,
  id: string,
  archived: boolean,
  client: PrismaClient = db,
): Promise<void> {
  requireCapability(actor, "product.write");
  await client.$transaction(async (tx) => {
    const product = await tx.product.findUnique({ where: { id } });
    if (!product) {
      throw new NotFoundError();
    }
    if (archived && (await onHandOf(tx, { variant: { productId: id } })) > 0) {
      throw new HasStockError();
    }
    if (!archived && product.archivedAt !== null) {
      await assertProductRoom(tx);
    }
    await tx.product.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
    await audit.log(tx, {
      userId: actor.id,
      action: archived ? "PRODUCT_ARCHIVED" : "PRODUCT_RESTORED",
      entityType: "Product",
      entityId: id,
      after: { code: product.code, name: product.name },
    });
  });
}

export async function setVariantArchived(
  actor: Actor,
  variantId: string,
  archived: boolean,
  client: PrismaClient = db,
): Promise<void> {
  requireCapability(actor, "product.write");
  await client.$transaction(async (tx) => {
    const variant = await tx.variant.findUnique({ where: { id: variantId } });
    if (!variant) {
      throw new NotFoundError();
    }
    if (archived && (await onHandOf(tx, { variantId })) > 0) {
      throw new HasStockError();
    }
    await tx.variant.update({
      where: { id: variantId },
      data: { archivedAt: archived ? new Date() : null },
    });
    await audit.log(tx, {
      userId: actor.id,
      action: archived ? "PRODUCT_ARCHIVED" : "PRODUCT_RESTORED",
      entityType: "Variant",
      entityId: variantId,
      after: { sku: variant.sku },
    });
  });
}

// ───────────────────────── Duplicar ─────────────────────────

/** "Copiar como nuevo": mismos datos y variantes, sin existencias ni historial, con códigos nuevos. */
export async function duplicateProduct(
  actor: Actor,
  id: string,
  client: PrismaClient = db,
): Promise<{ id: string; code: string }> {
  requireCapability(actor, "product.write");
  return client.$transaction(async (tx) => {
    const source = await tx.product.findUnique({
      where: { id },
      include: {
        variants: { where: { archivedAt: null }, include: { size: true, color: true } },
      },
    });
    if (!source) {
      throw new NotFoundError();
    }
    await assertProductRoom(tx);
    const code = await freshProductCode(tx);
    const copy = await tx.product.create({
      data: {
        code,
        name: `${source.name} (copia)`,
        description: source.description,
        categoryId: source.categoryId,
        brandId: source.brandId,
        seasonId: source.seasonId,
        defaultSupplierId: source.defaultSupplierId,
        basePriceCents: source.basePriceCents,
        baseCostCents: source.baseCostCents,
        taxCategory: source.taxCategory,
      },
    });

    const taken = new Set<string>();
    const prefix = await getSetting(tx, "barcode.internalPrefix");
    const serials = await nextSerials(tx, "barcode_serial_seq", source.variants.length);
    if (source.variants.length > 0) {
      await tx.variant.createMany({
        data: source.variants.map((variant, index) => ({
          productId: copy.id,
          sizeId: variant.sizeId,
          colorId: variant.colorId,
          sku: uniqueSku(buildSkuBase(code, variant.size?.name, variant.color?.name), taken),
          barcode: buildEan13(prefix, serials[index] ?? 0),
          priceCents: variant.priceCents,
          costCents: variant.costCents,
          avgCostCents: variant.costCents ?? source.baseCostCents,
          reorderPoint: variant.reorderPoint,
        })),
      });
    }
    await audit.log(tx, {
      userId: actor.id,
      action: "PRODUCT_CREATED",
      entityType: "Product",
      entityId: copy.id,
      after: { code, name: copy.name, duplicatedFrom: source.id, variants: source.variants.length },
    });
    return { id: copy.id, code };
  });
}

// ───────────────────────── Edición en bloque ─────────────────────────

function priceAfter(current: number, price: BulkEditInput["price"]): number {
  switch (price.mode) {
    case "set":
      return price.cents;
    case "percent": {
      const next = current + percentOf(current, price.bps);
      if (next < 1) {
        throw new ValidationError("Price would not be positive");
      }
      return next;
    }
    case "none":
      return current;
  }
}

export async function bulkEditProducts(
  actor: Actor,
  input: unknown,
  client: PrismaClient = db,
): Promise<{ updated: number }> {
  requireCapability(actor, "product.write");
  const data = parseInput(bulkEditSchema, input);
  if (data.price.mode !== "none") {
    requireCapability(actor, "price.change");
  }
  const reason = messages.products.bulk.title;
  return client.$transaction(async (tx) => {
    const products = await tx.product.findMany({
      where: { id: { in: data.productIds }, archivedAt: null },
      include: { variants: { where: { archivedAt: null } } },
    });
    if (products.length === 0) {
      throw new NotFoundError();
    }
    if (
      data.categoryId &&
      (await tx.category.count({ where: { id: data.categoryId, archivedAt: null } })) !== 1
    ) {
      throw new ValidationError("Unknown or archived category");
    }
    if (
      data.seasonId &&
      (await tx.season.count({ where: { id: data.seasonId, archivedAt: null } })) !== 1
    ) {
      throw new ValidationError("Unknown or archived season");
    }

    const placement = {
      ...(data.categoryId ? { categoryId: data.categoryId } : {}),
      ...(data.seasonId ? { seasonId: data.seasonId } : {}),
    };
    for (const product of products) {
      const newBase = priceAfter(product.basePriceCents, data.price);
      await tx.product.update({
        where: { id: product.id },
        data: { ...placement, basePriceCents: newBase },
      });

      if (Object.keys(placement).length > 0) {
        await audit.log(tx, {
          userId: actor.id,
          action: "PRODUCT_UPDATED",
          entityType: "Product",
          entityId: product.id,
          before: { categoryId: product.categoryId, seasonId: product.seasonId },
          after: placement,
          reason,
        });
      }
      if (newBase !== product.basePriceCents) {
        await tx.priceHistory.create({
          data: {
            productId: product.id,
            oldPriceCents: product.basePriceCents,
            newPriceCents: newBase,
            oldCostCents: product.baseCostCents,
            newCostCents: product.baseCostCents,
            changedById: actor.id,
            reason,
          },
        });
        await audit.log(tx, {
          userId: actor.id,
          action: "PRICE_CHANGED",
          entityType: "Product",
          entityId: product.id,
          before: { basePriceCents: product.basePriceCents },
          after: { basePriceCents: newBase },
          reason,
        });
      }

      if (data.price.mode === "none") {
        continue;
      }
      for (const variant of product.variants) {
        if (variant.priceCents === null) {
          continue;
        }
        // Con "poner este precio" las variantes vuelven a heredar; con porcentaje conservan su diferencia.
        const newOverride =
          data.price.mode === "set" ? null : priceAfter(variant.priceCents, data.price);
        await tx.variant.update({ where: { id: variant.id }, data: { priceCents: newOverride } });
        await tx.priceHistory.create({
          data: {
            variantId: variant.id,
            oldPriceCents: variant.priceCents,
            newPriceCents: newOverride ?? newBase,
            oldCostCents: variant.costCents ?? product.baseCostCents,
            newCostCents: variant.costCents ?? product.baseCostCents,
            changedById: actor.id,
            reason,
          },
        });
      }
    }
    return { updated: products.length };
  });
}

// ───────────────────────── Consultas ─────────────────────────

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, "\\$&");
}

/**
 * Búsqueda tolerante a mayúsculas, tildes y errores leves (RF-CAT-6): coincidencia exacta de código
 * o código de barras, nombre/marca/categoría que contienen el texto, y similitud de trigramas.
 */
export async function searchProductIds(client: PrismaClient, query: string): Promise<string[]> {
  const term = query.trim().slice(0, 100);
  if (term === "") {
    return [];
  }
  const contains = `%${escapeLike(term)}%`;
  const prefix = `${escapeLike(term)}%`;
  const rows = await client.$queryRaw<{ id: string }[]>`
    SELECT s."id" FROM (
      SELECT p."id", p."name",
        GREATEST(
          CASE WHEN unaccent(lower(p."name")) LIKE unaccent(lower(${contains}::text)) THEN 0.7 ELSE 0 END,
          similarity(unaccent(lower(p."name")), unaccent(lower(${term}::text))),
          word_similarity(unaccent(lower(${term}::text)), unaccent(lower(p."name"))) * 0.9,
          CASE WHEN lower(p."code") = lower(${term}::text) THEN 1 ELSE 0 END,
          CASE WHEN EXISTS (
            SELECT 1 FROM "Variant" v
            WHERE v."productId" = p."id"
              AND (v."barcode" = ${term}::text OR lower(v."sku") LIKE lower(${prefix}::text))
          ) THEN 1 ELSE 0 END,
          CASE WHEN unaccent(lower(b."name")) LIKE unaccent(lower(${contains}::text)) THEN 0.5 ELSE 0 END,
          CASE WHEN unaccent(lower(c."name")) LIKE unaccent(lower(${contains}::text)) THEN 0.4 ELSE 0 END
        ) AS score
      FROM "Product" p
      JOIN "Category" c ON c."id" = p."categoryId"
      LEFT JOIN "Brand" b ON b."id" = p."brandId"
    ) s
    WHERE s.score >= 0.4
    ORDER BY s.score DESC, s."name" ASC
    LIMIT ${PRODUCT_LIMITS.maxSearchMatches}
  `;
  return rows.map((row) => row.id);
}

/** Productos que cuentan para el límite del plan: los no archivados. */
export async function countActiveProducts(client: PrismaClient = db): Promise<number> {
  return client.product.count({ where: { archivedAt: null } });
}

export async function listProducts(
  params: ProductListParams = {},
  client: PrismaClient = db,
): Promise<ProductList> {
  const pageSize = PRODUCT_LIMITS.pageSize;
  const page = Math.max(1, Math.trunc(params.page ?? 1));
  const status = params.status ?? "active";

  const where: Prisma.ProductWhereInput = {
    ...(status === "active" ? { archivedAt: null } : {}),
    ...(status === "archived" ? { archivedAt: { not: null } } : {}),
    ...(params.brandId ? { brandId: params.brandId } : {}),
  };
  if (params.categoryId) {
    const categories = await client.category.findMany({ select: { id: true, parentId: true } });
    where.categoryId = {
      in: [params.categoryId, ...descendantsOf(categories, params.categoryId)],
    };
  }

  let pageIds: string[];
  let total: number;
  if (params.q?.trim()) {
    const matches = await searchProductIds(client, params.q);
    const allowed = new Set(
      (
        await client.product.findMany({
          where: { ...where, id: { in: matches } },
          select: { id: true },
        })
      ).map((product) => product.id),
    );
    const ordered = matches.filter((id) => allowed.has(id));
    total = ordered.length;
    pageIds = ordered.slice((page - 1) * pageSize, page * pageSize);
  } else {
    total = await client.product.count({ where });
    pageIds = (
      await client.product.findMany({
        where,
        orderBy: [{ name: "asc" }, { code: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: { id: true },
      })
    ).map((product) => product.id);
  }

  const products = await client.product.findMany({
    where: { id: { in: pageIds } },
    include: {
      category: { select: { name: true } },
      brand: { select: { name: true } },
      variants: { select: { id: true, archivedAt: true, reorderPoint: true } },
    },
  });
  const stock = await client.stockLevel.groupBy({
    by: ["variantId"],
    where: { variantId: { in: products.flatMap((product) => product.variants.map((v) => v.id)) } },
    _sum: { onHand: true },
  });
  const onHandByVariant = new Map(stock.map((row) => [row.variantId, row._sum.onHand ?? 0]));
  const byId = new Map(products.map((product) => [product.id, product]));

  const rows: ProductRow[] = pageIds.flatMap((id) => {
    const product = byId.get(id);
    if (!product) {
      return [];
    }
    const active = product.variants.filter((variant) => variant.archivedAt === null);
    return [
      {
        id: product.id,
        code: product.code,
        name: product.name,
        categoryName: product.category.name,
        brandName: product.brand?.name ?? "",
        basePriceCents: product.basePriceCents,
        baseCostCents: product.baseCostCents,
        variantCount: active.length,
        onHand: active.reduce((sum, variant) => sum + (onHandByVariant.get(variant.id) ?? 0), 0),
        lowStock: active.some(
          (variant) =>
            variant.reorderPoint !== null &&
            (onHandByVariant.get(variant.id) ?? 0) <= variant.reorderPoint,
        ),
        archived: product.archivedAt !== null,
      },
    ];
  });
  return { rows, total, page, pageSize };
}

export async function getProduct(
  id: string,
  client: PrismaClient = db,
): Promise<ProductDetail | null> {
  const product = await client.product.findUnique({
    where: { id },
    include: {
      variants: {
        include: { size: true, color: true, stockLevels: { select: { onHand: true } } },
      },
    },
  });
  if (!product) {
    return null;
  }
  const history = await client.priceHistory.findMany({
    where: { OR: [{ productId: id }, { variant: { productId: id } }] },
    include: {
      changedBy: { select: { name: true } },
      variant: { include: { size: true, color: true } },
    },
    orderBy: { changedAt: "desc" },
    take: 30,
  });

  const variants: VariantRow[] = [...product.variants]
    .sort(
      (a, b) =>
        (a.size?.sortOrder ?? -1) - (b.size?.sortOrder ?? -1) ||
        (a.color?.sortOrder ?? -1) - (b.color?.sortOrder ?? -1) ||
        a.sku.localeCompare(b.sku),
    )
    .map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      barcode: variant.barcode,
      sizeName: variant.size?.name ?? null,
      colorName: variant.color?.name ?? null,
      colorHex: variant.color?.hex ?? null,
      sizeId: variant.sizeId,
      colorId: variant.colorId,
      priceCents: variant.priceCents,
      costCents: variant.costCents,
      reorderPoint: variant.reorderPoint,
      onHand: variant.stockLevels.reduce((sum, level) => sum + level.onHand, 0),
      archived: variant.archivedAt !== null,
    }));

  const historyRows: PriceHistoryRow[] = history.map((row) => ({
    id: row.id,
    changedAt: row.changedAt,
    changedBy: row.changedBy.name,
    variantLabel: row.variant
      ? [row.variant.size?.name, row.variant.color?.name].filter(Boolean).join(" · ") ||
        row.variant.sku
      : null,
    oldPriceCents: row.oldPriceCents,
    newPriceCents: row.newPriceCents,
    oldCostCents: row.oldCostCents,
    newCostCents: row.newCostCents,
    reason: row.reason,
  }));

  return {
    id: product.id,
    code: product.code,
    name: product.name,
    description: product.description ?? "",
    categoryId: product.categoryId,
    brandId: product.brandId ?? "",
    seasonId: product.seasonId ?? "",
    supplierId: product.defaultSupplierId ?? "",
    basePriceCents: product.basePriceCents,
    baseCostCents: product.baseCostCents,
    taxCategory: product.taxCategory,
    archived: product.archivedAt !== null,
    variants,
    history: historyRows,
  };
}

/** Listas para los selectores. `keep` conserva las opciones archivadas que el producto aún usa. */
export async function getFormOptions(
  keep: { categoryId?: string; brandId?: string; seasonId?: string; supplierId?: string } = {},
  client: PrismaClient = db,
): Promise<ProductFormOptions> {
  const visible = (id: string | undefined) => ({
    OR: [{ archivedAt: null }, ...(id ? [{ id }] : [])],
  });
  const [categories, brands, seasons, suppliers, sizes, colors] = await Promise.all([
    client.category.findMany({
      where: visible(keep.categoryId),
      select: { id: true, name: true, parentId: true },
    }),
    client.brand.findMany({ where: visible(keep.brandId), orderBy: { name: "asc" } }),
    client.season.findMany({
      where: visible(keep.seasonId),
      orderBy: [{ startsAt: "desc" }, { name: "asc" }],
    }),
    client.supplier.findMany({ where: visible(keep.supplierId), orderBy: { name: "asc" } }),
    client.size.findMany({
      where: { archivedAt: null },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    client.color.findMany({
      where: { archivedAt: null },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
  ]);

  const byId = new Map(categories.map((category) => [category.id, category]));
  const path = (id: string): string => {
    const category = byId.get(id);
    return category
      ? category.parentId
        ? `${path(category.parentId)} › ${category.name}`
        : category.name
      : "";
  };
  const toOptions = (rows: { id: string; name: string }[]): Option[] =>
    rows.map((row) => ({ value: row.id, label: row.name }));

  return {
    categories: categories
      .map((category) => ({ value: category.id, label: path(category.id) }))
      .sort((a, b) => a.label.localeCompare(b.label, "es")),
    brands: toOptions(brands),
    seasons: toOptions(seasons),
    suppliers: toOptions(suppliers),
    sizes: sizes.map((size) => ({ id: size.id, name: size.name })),
    colors: colors.map((color) => ({ id: color.id, name: color.name, hex: color.hex })),
  };
}

/** Agrega una talla o un color desde el asistente, sin salir de la pantalla. */
export async function quickCreateOption(
  actor: Actor,
  input: unknown,
  client: PrismaClient = db,
): Promise<{ id: string; name: string; hex: string | null }> {
  const data = parseInput(quickOptionSchema, input);
  await createItem(actor, data.entity, { name: data.name }, client);
  const created =
    data.entity === "sizes"
      ? await client.size.findUnique({ where: { name: data.name } })
      : await client.color.findUnique({ where: { name: data.name } });
  if (!created) {
    throw new NotFoundError();
  }
  return {
    id: created.id,
    name: created.name,
    hex: "hex" in created ? (created.hex ?? null) : null,
  };
}
