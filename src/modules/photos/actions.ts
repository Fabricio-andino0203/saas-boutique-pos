"use server";

import { messages } from "@/config/messages.es";
import { toActionResult } from "@/lib/action-result";
import { requireUserCapability } from "@/lib/auth";
import { matchPhotoFileNames } from "@/modules/photos/bulk";
import type { PhotoActionState } from "@/modules/photos/schemas";
import {
  removeProductPhoto,
  reorderProductPhotos,
  setProductPhotoColor,
} from "@/modules/photos/service";
import type { FileMatch } from "@/modules/photos/types";

// Subir una foto no es una acción del servidor sino una ruta (`/api/productos/[id]/fotos`): una acción recibiría el archivo
// dentro del límite de 6 MB de todas las acciones y sin poder mostrar el avance. Cambiar el orden, el color o quitar sí.

export async function reorderPhotosAction(
  productId: string,
  orderedIds: string[],
): Promise<PhotoActionState> {
  const { user } = await requireUserCapability("product.write");
  const result = await toActionResult(
    () => reorderProductPhotos(user, String(productId), { orderedIds }),
    messages.errors,
  );
  return result.ok ? { success: messages.photos.saved } : { error: result.error.message };
}

export async function setPhotoColorAction(
  imageId: string,
  colorId: string | null,
): Promise<PhotoActionState> {
  const { user } = await requireUserCapability("product.write");
  const result = await toActionResult(
    () => setProductPhotoColor(user, String(imageId), colorId),
    messages.errors,
  );
  return result.ok ? { success: messages.photos.saved } : { error: result.error.message };
}

/** A qué producto pertenece cada archivo según su nombre (la carga masiva lo muestra antes de subir nada). */
export async function matchPhotoFilesAction(names: string[]): Promise<FileMatch[]> {
  await requireUserCapability("product.write");
  return matchPhotoFileNames(Array.isArray(names) ? names.map(String) : []);
}

export async function removePhotoAction(imageId: string): Promise<PhotoActionState> {
  const { user } = await requireUserCapability("product.write");
  const result = await toActionResult(
    () => removeProductPhoto(user, String(imageId)),
    messages.errors,
  );
  return result.ok ? { success: messages.photos.removed } : { error: result.error.message };
}
