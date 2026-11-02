import type { PhotoSize } from "@/lib/images";

/**
 * Las direcciones de las fotos. Se piden a la aplicación (con la sesión de quien las ve), no a una carpeta pública: la
 * dirección lleva el id de la foto y nada más, y la aplicación decide a qué negocio pertenece.
 */
export function photoUrl(imageId: string, size: PhotoSize): string {
  return `/api/fotos/${imageId}/${size}`;
}

/** Adónde se sube una foto nueva de un producto. */
export function photoUploadUrl(productId: string): string {
  return `/api/productos/${productId}/fotos`;
}
