import { db } from "@/lib/db";
import type { ReportAccess } from "@/modules/reports/access";
import {
  getSalesByHour,
  getSalesSummary,
  listProductSales,
  rankProducts,
  type ProductSalesRow,
  type ReportClient,
  type SalesHourRow,
  type SalesSummary,
} from "@/modules/reports/queries";
import { rangeForPreset, type ReportRange } from "@/modules/reports/ranges";

export type Dashboard = {
  range: ReportRange;
  summary: SalesSummary;
  /** Las horas de atención (8 a 20), con 0 donde no hubo ventas. */
  hours: SalesHourRow[];
  /** Los 5 productos que más se vendieron hoy. */
  top: ProductSalesRow[];
};

/** Una fila por hora entre `from` y `to` (incluidas); las horas sin ventas valen 0 y una venta fuera de ese rango la amplía. */
export function fillHours(rows: readonly SalesHourRow[], from = 8, to = 20): SalesHourRow[] {
  const first = Math.min(from, ...rows.map((row) => row.hour));
  const last = Math.max(to, ...rows.map((row) => row.hour));
  const byHour = new Map(rows.map((row) => [row.hour, row]));
  return Array.from({ length: last - first + 1 }, (_, index) => {
    const hour = first + index;
    return byHour.get(hour) ?? { hour, tickets: 0, salesCents: 0 };
  });
}

/**
 * Lo que muestra el inicio del día: ventas, tickets, ticket promedio y utilidad de hoy, ventas por hora y lo más
 * vendido. Son las mismas consultas de los reportes sobre el periodo "hoy", así que cada cifra se puede reconciliar con
 * el detalle de las ventas de hoy. El alcance y los costos salen de `reportAccess`: un cajero ve solo lo suyo.
 */
export async function getDashboard(
  access: ReportAccess,
  now: Date = new Date(),
  client: ReportClient = db,
): Promise<Dashboard> {
  const range = rangeForPreset("today", now);
  const summary = await getSalesSummary(range, access.scope, access.withCosts, client);
  const hours = fillHours(await getSalesByHour(range, access.scope, client));
  const top = rankProducts(await listProductSales(range, 1, access.scope, client), "best", 5);
  return { range, summary, hours, top };
}
