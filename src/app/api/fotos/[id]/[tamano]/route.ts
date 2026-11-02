import { getUsableSession } from "@/lib/auth";
import { servePhoto } from "@/modules/photos/http";

/** Una versión (`thumb`, `medium` o `large`) de una foto de producto. Sin sesión, o si no es de este negocio, responde como si no existiera. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; tamano: string }> },
): Promise<Response> {
  const { id, tamano } = await context.params;
  return servePhoto(await getUsableSession(), id, tamano);
}
