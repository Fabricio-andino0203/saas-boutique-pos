import path from "node:path";

import { createFileStore, type BlobStore } from "@/lib/blob-store";
import { env } from "@/lib/env";
import type { PhotoSize } from "@/lib/images";
import { resolveCurrentTenant } from "@/lib/tenancy/resolver";

/**
 * El almacén de las fotos y la dirección de cada archivo dentro de él. La dirección sale de ids que genera el servidor
 * (`negocio/producto/foto/tamaño.webp`): no se guarda en la base ni la escribe nadie, así restaurar una base en otro servidor
 * no deja direcciones rotas mientras la carpeta del negocio viaje con ella.
 */

let shared: BlobStore | undefined;

/** El almacén de esta instalación: la carpeta `UPLOADS_DIR` (o `.data/uploads` junto al proyecto en desarrollo). */
export function photoStore(): BlobStore {
  shared ??= createFileStore(env.UPLOADS_DIR ?? path.join(process.cwd(), ".data", "uploads"));
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
