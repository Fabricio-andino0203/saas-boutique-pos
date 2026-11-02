import { getUsableSession } from "@/lib/auth";
import { hasCapability } from "@/lib/permissions";
import { buildTemplateCsv, buildTemplateXlsx } from "@/modules/products/import/template";

const FILE_NAME = "plantilla-productos";

/** Descarga la plantilla de importación (Excel o CSV). Sin permiso responde como si no existiera. */
export async function GET(request: Request): Promise<Response> {
  const session = await getUsableSession();
  if (!session || !hasCapability(session.user.role, "product.write")) {
    return new Response(null, { status: 404 });
  }

  const format = new URL(request.url).searchParams.get("formato");
  if (format === "csv") {
    return new Response(buildTemplateCsv(), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${FILE_NAME}.csv"`,
      },
    });
  }
  const bytes = await buildTemplateXlsx();
  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${FILE_NAME}.xlsx"`,
    },
  });
}
