import path from "node:path";

import { createFileStore, type BlobStore } from "@/lib/blob-store";
import { env } from "@/lib/env";
import type { PhotoSize } from "@/lib/images";
import { createS3Store } from "@/lib/s3-blob-store";
import { resolveCurrentTenant } from "@/lib/tenancy/resolver";

/**
 * El almacén de las fotos y la dirección de cada archivo dentro de él. La dirección sale de ids que genera el servidor
 * (`negocio/producto/foto/tamaño.webp`): no se guarda en la base ni la escribe nadie, así restaurar una base en otro servidor
 * no deja direcciones rotas mientras la carpeta del negocio viaje con ella.
 */

let shared: BlobStore | undefined;

/** Cuál es el almacén de esta instalación, para el registro de arranque: `s3` o la carpeta en uso. */
export function photoStoreDescription(): string {
  return env.S3_BUCKET ? "s3" : `file:${photoFolderRoot()}`;
}

function photoFolderRoot(): string {
  return env.UPLOADS_DIR ?? path.join(process.cwd(), ".data", "uploads");
}

/**
 * El almacén de esta instalación: el bucket `S3_BUCKET` si está definido; si no, la carpeta `UPLOADS_DIR` (o `.data/uploads`
 * junto al proyecto en desarrollo).
 */
export function photoStore(): BlobStore {
  shared ??= env.S3_BUCKET
    ? createS3Store({
        endpoint: env.S3_ENDPOINT,
        region: env.S3_REGION ?? "auto",
        bucket: env.S3_BUCKET,
        accessKeyId: env.S3_ACCESS_KEY_ID as string,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY as string,
        forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
      })
    : createFileStore(photoFolderRoot());
  return shared;
}

/**
 * La carpeta del negocio de esta petición. Es el id del negocio (`single` en una instalación de una sola tienda): sale del
 * contexto verificado, nunca de la petición, y falla cerrado si no hay negocio.
 */
export async function currentPhotoFolder(): Promise<string> {
  return (await resolveCurrentTenant()).id;
}

export function photoKey(
  folder: string,
  productId: string,
  imageId: string,
  size: PhotoSize,
): string {
  return `${folder}/${productId}/${imageId}/${size}.webp`;
}

/** Un id nuevo para una foto: lleva prefijo para empezar siempre con una letra y sirve de carpeta. */
export function newPhotoId(): string {
  return `ph${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
}
