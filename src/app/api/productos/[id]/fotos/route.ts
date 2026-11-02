import { getUsableSession } from "@/lib/auth";
import { handlePhotoUpload } from "@/modules/photos/http";

/** Sube UNA foto a un producto (`multipart/form-data`: `file` y, si es de un color, `colorId`). Responde con JSON. */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  return handlePhotoUpload(await getUsableSession(), id, request);
}
