import { messages } from "@/config/messages.es";
import { AppError, ImageTooLargeError, InvalidImageError } from "@/lib/errors";
import { PHOTO_MAX_BYTES, isPhotoSize } from "@/lib/images";
import { logger } from "@/lib/logger";
import { hasCapability, type Role } from "@/lib/permissions";
import { findPhotoProduct } from "@/modules/photos/queries";
import { addProductPhoto, type PhotoDeps } from "@/modules/photos/service";
import { currentPhotoFolder, photoKey, photoStore } from "@/modules/photos/storage";

/**
 * Lo que hacen las dos rutas de fotos (`/api/fotos/...` y `/api/productos/.../fotos`), sin depender de la sesión de la
 * petición: la ruta la lee y la pasa aquí. Así se prueban con una sesión inventada, y la regla de «quién puede qué» vive en
 * un solo lugar.
 */

export type PhotoSession = { user: { id: string; role: Role } };

/** Una foto subida pesa a lo más esto; el cuerpo trae además unos bytes de la forma. */
const MAX_BODY_BYTES = PHOTO_MAX_BYTES + 512 * 1024;

const NOT_FOUND = () => new Response(null, { status: 404 });

/**
 * Entrega una versión de una foto. Sin sesión, con un tamaño que no existe, con una foto que no es de **este** negocio o
 * cuyo archivo ya no está (por ejemplo, tras restaurar la base sin sus archivos), responde 404 sin decir cuál fue el motivo.
 * Cualquier persona con sesión puede verlas: el cajero las necesita en el punto de venta.
 */
export async function servePhoto(
  session: PhotoSession | null,
  imageId: string,
  size: string,
  deps: PhotoDeps = {},
): Promise<Response> {
  if (!session || !isPhotoSize(size) || imageId.length === 0 || imageId.length > 60) {
    return NOT_FOUND();
  }
  const found = await findPhotoProduct(imageId, deps.client);
  if (!found) {
    return NOT_FOUND();
  }
  const folder = deps.folder ?? (await currentPhotoFolder());
  const bytes = await (deps.store ?? photoStore()).get(
    photoKey(folder, found.productId, imageId, size),
  );
  if (!bytes) {
    return NOT_FOUND();
  }
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "image/webp",
      "Content-Length": String(bytes.length),
      // Cada subida tiene su propio id y el archivo nunca cambia: el navegador puede guardarla todo el año.
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function failure(code: keyof typeof messages.errors, status: number): Response {
  return Response.json({ ok: false, error: { code, message: messages.errors[code] } }, { status });
}

/**
 * Una petición `POST` desde otra página (otro origen) no se acepta, aunque traiga la cookie: la cookie es `SameSite=Lax`,
 * que ya lo impide en los navegadores actuales, y esto es la segunda barrera.
 */
function isCrossOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) {
    return false;
  }
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

/** Recibe UNA foto (`file`, y opcionalmente `colorId`) para un producto y responde con JSON. */
export async function handlePhotoUpload(
  session: PhotoSession | null,
  productId: string,
  request: Request,
  deps: PhotoDeps = {},
): Promise<Response> {
  if (!session) {
    return failure("UNAUTHORIZED", 401);
  }
  if (isCrossOrigin(request) || !hasCapability(session.user.role, "product.write")) {
    return failure("FORBIDDEN", 403);
  }
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return failure("IMAGE_TOO_LARGE", new ImageTooLargeError().status);
  }

  try {
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!form || !(file instanceof File)) {
      throw new InvalidImageError();
    }
    const colorId = form.get("colorId");
    const photo = await addProductPhoto(
      session.user,
      productId,
      {
        data: new Uint8Array(await file.arrayBuffer()),
        name: file.name,
        colorId: typeof colorId === "string" ? colorId : null,
      },
      deps,
    );
    return Response.json({ ok: true, photo }, { status: 201 });
  } catch (error) {
    if (error instanceof AppError) {
      return failure(error.code, error.status);
    }
    logger.error("photos.upload_failed", { error });
    return failure("UNEXPECTED", 500);
  }
}
