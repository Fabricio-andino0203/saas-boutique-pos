import { PHOTO_LIMITS } from "@/config/constants";
import type { PrismaClient } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import type { BlobStore } from "@/lib/blob-store";
import { db } from "@/lib/db";
import { assertWithinPlanLimit } from "@/lib/entitlements";
import { ConflictError, NotFoundError, PhotoLimitError, ValidationError } from "@/lib/errors";
import { PHOTO_SIZE_NAMES, processPhoto } from "@/lib/images";
import { logger } from "@/lib/logger";
import { requireCapability } from "@/lib/permissions";
import type { Actor } from "@/modules/catalog/service";
import { photoColorSchema, cleanFileName, reorderPhotosSchema } from "@/modules/photos/schemas";
import { currentPhotoFolder, newPhotoId, photoKey, photoStore } from "@/modules/photos/storage";
import { photoSelect, toProductPhoto, type ProductPhoto } from "@/modules/photos/queries";

/**
 * Las fotos de los productos. Los archivos van al almacén y la base guarda solo el registro (`ProductImage`); como no hay
 * una transacción que cubra las dos cosas, el orden es: **archivos primero, registro después** y, si el registro falla,
 * se borran los archivos recién escritos; al quitar una foto se borra el registro y **después** los archivos. Lo peor que
 * puede pasar por un corte justo en medio es un archivo huérfano sin registro (ocupa espacio, no se ve), nunca un registro
 * que apunte a un archivo que no está.
 */

export type PhotoDeps = {
  client?: PrismaClient;
  store?: BlobStore;
  /** La carpeta del negocio dentro del almacén. Por omisión, la del negocio de la petición. */
  folder?: string;
};

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export type PhotoUpload = {
  data: Uint8Array;
  /** Nombre del archivo, solo para mostrarlo. */
  name?: string | null;
  /** De qué color es la foto; vacío = foto general del producto. */
  colorId?: string | null;
};

async function lockProductPhotos(tx: Tx, productId: string): Promise<void> {
  await tx.$queryRaw`
    SELECT 1 AS "locked" FROM (SELECT pg_advisory_xact_lock(hashtext(${`photos:${productId}`}))) AS "lock"
  `;
}

/** El color de una foto debe ser uno de los que el producto tiene en sus variantes. */
async function assertProductHasColor(
  client: Pick<PrismaClient, "variant">,
  productId: string,
  colorId: string,
): Promise<void> {
  const found = await client.variant.findFirst({
    where: { productId, colorId },
    select: { id: true },
  });
  if (!found) {
    throw new ValidationError("The product has no variant of that color");
  }
}

async function removeFilesQuietly(
  store: BlobStore,
  keys: readonly string[],
  event: string,
): Promise<void> {
  try {
    await store.remove(keys);
  } catch (error) {
    // Un archivo que no se pudo borrar queda huérfano; no debe romper lo que ya se hizo en la base.
    logger.error(event, { error });
  }
}

function keysOf(folder: string, productId: string, imageId: string): string[] {
  return PHOTO_SIZE_NAMES.map((size) => photoKey(folder, productId, imageId, size));
}

export async function addProductPhoto(
  actor: Actor,
  productId: string,
  upload: PhotoUpload,
  deps: PhotoDeps = {},
): Promise<ProductPhoto> {
  requireCapability(actor, "product.write");
  const client = deps.client ?? db;
  const colorId = photoColorSchema.parse(upload.colorId);

  const product = await client.product.findUnique({
    where: { id: productId },
    select: { id: true },
  });
  if (!product) {
    throw new NotFoundError();
  }
  if (colorId) {
    await assertProductHasColor(client, productId, colorId);
  }
  // Aviso temprano y barato; el definitivo está dentro de la transacción, con el candado.
  if ((await client.productImage.count({ where: { productId } })) >= PHOTO_LIMITS.maxPerProduct) {
    throw new PhotoLimitError();
  }

  // Lo pesado (decodificar y convertir) va fuera de la transacción: no se sostiene el candado mientras se procesa.
  const processed = await processPhoto(upload.data);

  const store = deps.store ?? photoStore();
  const folder = deps.folder ?? (await currentPhotoFolder());
  const imageId = newPhotoId();
  const keys = keysOf(folder, productId, imageId);

  try {
    // Se espera a que terminen **todas**, también después de un fallo: así la limpieza de abajo no se adelanta a una
    // escritura que sigue en curso y que dejaría su archivo suelto.
    const writes = await Promise.allSettled(
      PHOTO_SIZE_NAMES.map((size, index) =>
        store.put(keys[index] as string, processed.variants[size].data),
      ),
    );
    for (const write of writes) {
      if (write.status === "rejected") {
        throw write.reason;
      }
    }
    const created = await client.$transaction(async (tx) => {
      await lockProductPhotos(tx, productId);
      const current = await tx.productImage.count({ where: { productId } });
      if (current >= PHOTO_LIMITS.maxPerProduct) {
        throw new PhotoLimitError();
      }
      await assertWithinPlanLimit("photos", () => tx.productImage.count());
      const row = await tx.productImage.create({
        data: {
          id: imageId,
          productId,
          colorId,
          position: current,
          width: processed.width,
          height: processed.height,
          bytes: PHOTO_SIZE_NAMES.reduce((sum, size) => sum + processed.variants[size].bytes, 0),
          originalName: cleanFileName(upload.name),
        },
        select: photoSelect,
      });
      await audit.log(tx, {
        userId: actor.id,
        action: "PRODUCT_PHOTO_ADDED",
        entityType: "Product",
        entityId: productId,
        after: { imageId, colorId, position: current },
      });
      return row;
    });
    return toProductPhoto(created);
  } catch (error) {
    await removeFilesQuietly(store, keys, "photos.cleanup_failed");
    throw error;
  }
}

export async function removeProductPhoto(
  actor: Actor,
  imageId: string,
  deps: PhotoDeps = {},
): Promise<void> {
  requireCapability(actor, "product.write");
  const client = deps.client ?? db;

  const image = await client.productImage.findUnique({
    where: { id: imageId },
    select: { productId: true },
  });
  if (!image) {
    throw new NotFoundError();
  }
  const { productId } = image;

  await client.$transaction(async (tx) => {
    await lockProductPhotos(tx, productId);
    const found = await tx.productImage.findUnique({
      where: { id: imageId },
      select: { position: true, colorId: true },
    });
    if (!found) {
      throw new NotFoundError();
    }
    await tx.productImage.delete({ where: { id: imageId } });
    await tx.productImage.updateMany({
      where: { productId, position: { gt: found.position } },
      data: { position: { decrement: 1 } },
    });
    await audit.log(tx, {
      userId: actor.id,
      action: "PRODUCT_PHOTO_REMOVED",
      entityType: "Product",
      entityId: productId,
      before: { imageId, colorId: found.colorId, position: found.position },
    });
  });

  const folder = deps.folder ?? (await currentPhotoFolder());
  await removeFilesQuietly(
    deps.store ?? photoStore(),
    keysOf(folder, productId, imageId),
    "photos.remove_failed",
  );
}

/** Pone las fotos de un producto en el orden dado (debe traer exactamente las que tiene). La primera pasa a ser la principal. */
export async function reorderProductPhotos(
  actor: Actor,
  productId: string,
  input: unknown,
  deps: PhotoDeps = {},
): Promise<void> {
  requireCapability(actor, "product.write");
  const parsed = reorderPhotosSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError("Invalid photo order", { cause: parsed.error });
  }
  const { orderedIds } = parsed.data;
  const client = deps.client ?? db;

  await client.$transaction(async (tx) => {
    await lockProductPhotos(tx, productId);
    const current = await tx.productImage.findMany({
      where: { productId },
      orderBy: { position: "asc" },
      select: { id: true },
    });
    const known = new Set(current.map((row) => row.id));
    // Si alguien subió o quitó una foto mientras tanto, la lista de esta persona ya no es la real: que la recargue.
    if (
      orderedIds.length !== current.length ||
      new Set(orderedIds).size !== orderedIds.length ||
      orderedIds.some((id) => !known.has(id))
    ) {
      throw new ConflictError("The photos changed in the meantime");
    }
    for (const [position, id] of orderedIds.entries()) {
      await tx.productImage.update({ where: { id }, data: { position } });
    }
  });
}

/** Cambia a qué color pertenece una foto (`null` = foto general del producto). */
export async function setProductPhotoColor(
  actor: Actor,
  imageId: string,
  colorInput: unknown,
  deps: PhotoDeps = {},
): Promise<void> {
  requireCapability(actor, "product.write");
  const client = deps.client ?? db;
  const colorId = photoColorSchema.parse(colorInput);

  const image = await client.productImage.findUnique({
    where: { id: imageId },
    select: { productId: true },
  });
  if (!image) {
    throw new NotFoundError();
  }
  if (colorId) {
    await assertProductHasColor(client, image.productId, colorId);
  }
  await client.productImage.update({ where: { id: imageId }, data: { colorId } });
}
