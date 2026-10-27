import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { descendantsOf } from "@/modules/catalog/service";
import type {
  LookupResult,
  PosCategory,
  SellableProduct,
  SellableVariant,
} from "@/modules/sales/pos-types";

const RESULT_LIMIT = 24;
const MAX_TERMS = 4;

const productInclude = {
  category: { select: { name: true } },
  variants: {
    where: { archivedAt: null },
    orderBy: [{ size: { sortOrder: "asc" } }, { sku: "asc" }],
    include: {
      size: { select: { name: true } },
      color: { select: { name: true, hex: true } },
      stockLevels: { select: { onHand: true } },
    },
  },
} satisfies Prisma.ProductInclude;

type ProductRow = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

function toSellable(product: ProductRow): SellableProduct {
  return {
    productId: product.id,
    code: product.code,
    name: product.name,
    categoryName: product.category.name,
    variants: product.variants.map((variant): SellableVariant => ({
      variantId: variant.id,
      sku: variant.sku,
      barcode: variant.barcode,
      sizeName: variant.size?.name ?? null,
      colorName: variant.color?.name ?? null,
      colorHex: variant.color?.hex ?? null,
      priceCents: variant.priceCents ?? product.basePriceCents,
      onHand: variant.stockLevels.reduce((sum, level) => sum + level.onHand, 0),
      taxExempt: product.taxCategory === "EXEMPT",
    })),
  };
}

async function loadProduct(
  client: PrismaClient,
  productId: string,
): Promise<SellableProduct | null> {
  const product = await client.product.findFirst({
    where: { id: productId, archivedAt: null },
    include: productInclude,
  });
  return product && product.variants.length > 0 ? toSellable(product) : null;
}

/** Cada palabra escrita debe aparecer en el nombre, el código, el color, la talla o el código de barras. */
function termFilter(term: string): Prisma.ProductWhereInput {
  const text = { contains: term, mode: "insensitive" } as const;
  return {
    OR: [
      { name: text },
      { code: text },
      {
        variants: {
          some: {
            archivedAt: null,
            OR: [
              { sku: text },
              { barcode: term },
              { color: { name: text } },
              { size: { name: { equals: term, mode: "insensitive" } } },
            ],
          },
        },
      },
    ],
  };
}

/** Prendas para vender, agrupadas por producto; sin texto muestra las primeras por nombre. */
export async function searchSellable(
  params: { q?: string; categoryId?: string },
  client: PrismaClient = db,
): Promise<SellableProduct[]> {
  const terms = (params.q ?? "").trim().split(/\s+/).filter(Boolean).slice(0, MAX_TERMS);

  let categoryIds: string[] | undefined;
  if (params.categoryId) {
    const categories = await client.category.findMany({ select: { id: true, parentId: true } });
    categoryIds = [params.categoryId, ...descendantsOf(categories, params.categoryId)];
  }

  const products = await client.product.findMany({
    where: {
      archivedAt: null,
      variants: { some: { archivedAt: null } },
      ...(categoryIds ? { categoryId: { in: categoryIds } } : {}),
      ...(terms.length > 0 ? { AND: terms.map(termFilter) } : {}),
    },
    orderBy: { name: "asc" },
    take: RESULT_LIMIT,
    include: productInclude,
  });
  return products.map(toSellable);
}

/**
 * Un código exacto (escáner o escrito): código de barras o código de la variante entra directo; el código de
 * un producto entra directo si solo tiene una variante, y si tiene varias se deja elegir.
 */
export async function lookupCode(code: string, client: PrismaClient = db): Promise<LookupResult> {
  const term = code.trim();
  if (term === "") {
    return { kind: "none" };
  }

  const variant = await client.variant.findFirst({
    where: {
      archivedAt: null,
      product: { archivedAt: null },
      OR: [{ barcode: term }, { sku: { equals: term, mode: "insensitive" } }],
    },
    select: { id: true, productId: true },
  });
  if (variant) {
    const product = await loadProduct(client, variant.productId);
    const found = product?.variants.find((candidate) => candidate.variantId === variant.id);
    if (product && found) {
      return { kind: "variant", productName: product.name, variant: found };
    }
  }

  const byCode = await client.product.findFirst({
    where: { archivedAt: null, code: { equals: term, mode: "insensitive" } },
    select: { id: true },
  });
  if (byCode) {
    const product = await loadProduct(client, byCode.id);
    if (product) {
      const [only] = product.variants;
      return product.variants.length === 1 && only
        ? { kind: "variant", productName: product.name, variant: only }
        : { kind: "product", product };
    }
  }
  return { kind: "none" };
}

/** Categorías de primer nivel, para los filtros de la pantalla de venta. */
export async function listPosCategories(client: PrismaClient = db): Promise<PosCategory[]> {
  return client.category.findMany({
    where: { parentId: null, archivedAt: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}
