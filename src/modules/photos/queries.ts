import type { PrismaClient } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { ProductPhoto } from "@/modules/photos/types";

export type { ProductPhoto };

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
