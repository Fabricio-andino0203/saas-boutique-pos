import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { PhotoProductRow, ProductPhoto } from "@/modules/photos/types";
import { searchProductIds } from "@/modules/products/service";

export type { PhotoProductRow, ProductPhoto };

type PhotoRecord = {
  id: string;
  productId: string;
  colorId: string | null;
  position: number;
  width: number;
  height: number;
  bytes: number;
  originalName: string | null;
  color: { name: string; hex: string | null } | null;
};

export const photoSelect = {
  id: true,
  productId: true,
  colorId: true,
  position: true,
  width: true,
  height: true,
  bytes: true,
  originalName: true,
  color: { select: { name: true, hex: true } },
} as const;

export function toProductPhoto(row: PhotoRecord): ProductPhoto {
  return {
    id: row.id,
    productId: row.productId,
    colorId: row.colorId,
    colorName: row.color?.name ?? null,
    colorHex: row.color?.hex ?? null,
    position: row.position,
    width: row.width,
    height: row.height,
    bytes: row.bytes,
    originalName: row.originalName,
  };
}

/** Las fotos de un producto, en su orden (la primera es la principal). */
export async function listProductPhotos(
  productId: string,
  client: PrismaClient = db,
): Promise<ProductPhoto[]> {
  const rows = await client.productImage.findMany({
    where: { productId },
    orderBy: { position: "asc" },
    select: photoSelect,
  });
  return rows.map(toProductPhoto);
}

/** De qué producto es una foto, o `null` si no existe en este negocio. Es lo que decide si se puede entregar el archivo. */
export async function findPhotoProduct(
  imageId: string,
  client: PrismaClient = db,
): Promise<{ productId: string } | null> {
  return client.productImage.findUnique({ where: { id: imageId }, select: { productId: true } });
}

/** La foto principal (posición 0) de cada producto dado: `productId → id de la foto`. Los que no tienen foto no aparecen. */
export async function coverPhotoIds(
  productIds: readonly string[],
  client: PrismaClient = db,
): Promise<Map<string, string>> {
  if (productIds.length === 0) {
    return new Map();
  }
  const rows = await client.productImage.findMany({
    where: { productId: { in: [...productIds] }, position: 0 },
    select: { id: true, productId: true },
  });
  return new Map(rows.map((row) => [row.productId, row.id]));
}

/** Cuánto espacio usan las fotos del negocio y cuántas son. */
export async function photoUsage(
  client: PrismaClient = db,
): Promise<{ count: number; bytes: number }> {
  const total = await client.productImage.aggregate({
    _count: { _all: true },
    _sum: { bytes: true },
  });
  return { count: total._count._all, bytes: total._sum.bytes ?? 0 };
}

export const PHOTO_GRID_PAGE_SIZE = 24;

export type PhotoProductList = {
  rows: PhotoProductRow[];
  total: number;
  page: number;
  pageSize: number;
  /** De todos los productos activos del negocio (sin importar el filtro): cuántos ya tienen foto y cuántos hay. */
  withPhotos: number;
  active: number;
};

/** Los productos activos para el módulo de fotos: por omisión los que aún no tienen foto, con búsqueda por nombre o código. */
export async function listProductsForPhotos(
  params: { q?: string; missingOnly?: boolean; page?: number },
  client: PrismaClient = db,
): Promise<PhotoProductList> {
  const page = Math.max(1, Math.trunc(params.page ?? 1));
  const where: Prisma.ProductWhereInput = {
    archivedAt: null,
    ...(params.missingOnly ? { images: { none: {} } } : {}),
  };
  if (params.q?.trim()) {
    where.id = { in: await searchProductIds(client, params.q) };
  }

  const [total, withPhotos, active, products] = await Promise.all([
    client.product.count({ where }),
    client.product.count({ where: { archivedAt: null, images: { some: {} } } }),
    client.product.count({ where: { archivedAt: null } }),
    client.product.findMany({
      where,
      orderBy: [{ name: "asc" }, { code: "asc" }],
      skip: (page - 1) * PHOTO_GRID_PAGE_SIZE,
      take: PHOTO_GRID_PAGE_SIZE,
      select: {
        id: true,
        code: true,
        name: true,
        images: { orderBy: { position: "asc" }, take: 1, select: { id: true } },
        _count: { select: { images: true } },
      },
    }),
  ]);
  return {
    rows: products.map((product) => ({
      id: product.id,
      code: product.code,
      name: product.name,
      coverImageId: product.images[0]?.id ?? null,
      photoCount: product._count.images,
    })),
    total,
    page,
    pageSize: PHOTO_GRID_PAGE_SIZE,
    withPhotos,
    active,
  };
}
