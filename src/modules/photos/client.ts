import { PHOTO_LIMITS } from "@/config/constants";
import { messages } from "@/config/messages.es";
import { photoUploadUrl } from "@/modules/photos/urls";
import type { ProductPhoto } from "@/modules/photos/types";

/** Lo que corre en el navegador para subir fotos. No importa nada del servidor. */

export type UploadResult = { ok: true; photo: ProductPhoto } | { ok: false; message: string };

/**
 * Reduce una foto pesada antes de subirla: una foto de celular de 6 MB llega como una de unos 400 KB, sube en un
 * instante y no se pierde nada que se note en pantalla. Si el navegador no puede (formato raro, sin lienzo), se sube tal cual
 * y el servidor decide. Una foto que ya es liviana no se toca.
 */
export async function shrinkPhoto(file: File): Promise<File> {
  if (file.size <= PHOTO_LIMITS.shrinkAboveBytes || typeof createImageBitmap !== "function") {
    return file;
  }
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, PHOTO_LIMITS.shrinkEdge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      return file;
    }
    context.fillStyle = "#ffffff"; // un PNG transparente no debe quedar negro al pasar a JPG
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.88),
    );
    if (!blob || blob.size >= file.size) {
      return file;
    }
    return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  }
}

/** Sube UNA foto a un producto. Nunca lanza: devuelve el motivo, ya en palabras de la persona, para mostrarlo. */
export async function uploadProductPhoto(
  productId: string,
  file: File,
  colorId?: string | null,
): Promise<UploadResult> {
  const prepared = await shrinkPhoto(file);
  const form = new FormData();
  form.set("file", prepared, prepared.name);
  if (colorId) {
    form.set("colorId", colorId);
  }
  try {
    const response = await fetch(photoUploadUrl(productId), {
      method: "POST",
      body: form,
      credentials: "same-origin",
    });
    if (response.redirected || response.status === 401) {
      return { ok: false, message: messages.errors.UNAUTHORIZED }; // la sesión terminó
    }
    const body = (await response.json().catch(() => null)) as
      { ok: true; photo: ProductPhoto } | { ok: false; error: { message: string } } | null;
    if (response.ok && body?.ok) {
      return { ok: true, photo: body.photo };
    }
    return {
      ok: false,
      message: body && !body.ok ? body.error.message : messages.errors.UNEXPECTED,
    };
  } catch {
    return { ok: false, message: messages.photos.network };
  }
}
