import { getUsableSession } from "@/lib/auth";
import {
  buildFinanceExport,
  isFinanceExportKind,
  type FinanceExportParams,
} from "@/modules/finance/export";
import { toCsv, toXlsx } from "@/modules/reports/export";

const PARAM_NAMES = ["rango", "desde", "hasta", "tipo", "categoria", "pago", "anulados"] as const;

/**
 * Descarga el resumen o los movimientos de Finanzas en Excel (`formato=xlsx`, el predeterminado) o CSV con los mismos
 * filtros que la pantalla. Sin sesión o sin `finance.view` responde como si no existiera (y los negocios cuyo plan no incluye
 * Finanzas ni llegan aquí: el proxy corta `/api/finanzas`).
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ tipo: string }> },
): Promise<Response> {
  const session = await getUsableSession();
  const { tipo } = await context.params;
  if (!session || !isFinanceExportKind(tipo)) {
    return new Response(null, { status: 404 });
  }
  const url = new URL(request.url);
  const params: FinanceExportParams = {};
  for (const name of PARAM_NAMES) {
    const value = url.searchParams.get(name);
    if (value !== null) {
      params[name] = value;
    }
  }
  const table = await buildFinanceExport(tipo, params, session.user);
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
