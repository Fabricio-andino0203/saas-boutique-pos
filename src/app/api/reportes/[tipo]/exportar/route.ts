import { getSession } from "@/lib/auth";
import {
  buildExport,
  isExportKind,
  toCsv,
  toXlsx,
  type ExportParams,
} from "@/modules/reports/export";

const PARAM_NAMES = [
  "rango",
  "desde",
  "hasta",
  "por",
  "orden",
  "categoria",
  "dias",
  "parte",
] as const;

/**
 * Descarga un reporte en Excel (`formato=xlsx`, el predeterminado) o CSV (`formato=csv`) con los mismos filtros que la
 * pantalla. Sin sesión o sin permiso para ese reporte responde como si no existiera. Los costos solo salen con el
 * permiso financiero, y un cajero recibe solo sus ventas: lo decide `buildExport`, igual que las pantallas.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ tipo: string }> },
): Promise<Response> {
  const session = await getSession();
  const { tipo } = await context.params;
  if (!session || !isExportKind(tipo)) {
    return new Response(null, { status: 404 });
  }
  const url = new URL(request.url);
  const params: ExportParams = {};
  for (const name of PARAM_NAMES) {
    const value = url.searchParams.get(name);
    if (value !== null) {
      params[name] = value;
    }
  }
  const table = await buildExport(tipo, params, session.user);
  if (!table) {
    return new Response(null, { status: 404 });
  }

  const name = table.fileBase.replace(/[^a-zA-Z0-9._-]/g, "-");
  if (url.searchParams.get("formato") === "csv") {
    return new Response(toCsv(table), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }
  return new Response((await toXlsx(table)) as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
