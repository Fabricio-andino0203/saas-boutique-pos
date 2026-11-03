import { messages } from "@/config/messages.es";
import { formatLocalDate } from "@/lib/dates";
import { hasCapability, type Role } from "@/lib/permissions";
import {
  getFinanceSummary,
  listFinanceEntries,
  type EntryFilters,
} from "@/modules/finance/queries";
import {
  ALL_PAYMENT_METHODS,
  FINANCE_ENTRY_TYPES,
  type FinanceType,
  type PaymentMethod,
} from "@/modules/finance/schemas";
import type { CellKind, ExportColumn, ExportTable } from "@/modules/reports/export";
import { parseRange } from "@/modules/reports/ranges";

/**
 * Exportación de Finanzas a Excel y CSV (RF-FIN-8): las mismas consultas y filtros que las pantallas, y solo con
 * `finance.view`. Reutiliza las hojas y los escritores de los reportes (`toXlsx`, `toCsv`).
 */

export const FINANCE_EXPORT_KINDS = ["resumen", "movimientos"] as const;
export type FinanceExportKind = (typeof FINANCE_EXPORT_KINDS)[number];

export function isFinanceExportKind(value: string): value is FinanceExportKind {
  return (FINANCE_EXPORT_KINDS as readonly string[]).includes(value);
}

export type FinanceExportParams = Partial<
  Record<"rango" | "desde" | "hasta" | "tipo" | "categoria" | "pago" | "anulados", string>
>;

const copy = messages.finance.export;

/** Una cantidad de centavos como número de lempiras con dos decimales (para una celda de Excel). */
const lempiras = (cents: number): number => Math.round(cents) / 100;

const col = (
  header: string,
  key: string,
  kind: CellKind = "text",
  width?: number,
): ExportColumn => ({
  header,
  key,
  kind,
  width,
});

export async function buildFinanceExport(
  kind: FinanceExportKind,
  params: FinanceExportParams,
  user: { id: string; role: Role },
  now: Date = new Date(),
): Promise<ExportTable | null> {
  if (!hasCapability(user.role, "finance.view")) {
    return null;
  }
  const range = parseRange({ rango: params.rango, desde: params.desde, hasta: params.hasta }, now);
  const period = `${range.fromKey}_${range.toKey}`;

  if (kind === "resumen") {
    const summary = await getFinanceSummary(range);
    const lines = messages.finance.summary.lines;
    const categoryColumns = [
      col(copy.category, "category", "text", 34),
      col(copy.amount, "amount", "money", 18),
    ];
    const byCategory = (rows: typeof summary.expenseLines) =>
      rows.map((row) => ({ category: row.name, amount: lempiras(row.totalCents) }));
    return {
      fileBase: `finanzas-resumen-${period}`,
      sheets: [
        {
          name: copy.summarySheet,
          primary: true,
          columns: [
            col(copy.concept, "concept", "text", 44),
            col(copy.amount, "amount", "money", 18),
          ],
          rows: [
            { concept: lines.revenue, amount: lempiras(summary.revenueCents) },
            { concept: lines.cost, amount: lempiras(-summary.costOfSalesCents) },
            { concept: lines.gross, amount: lempiras(summary.grossProfitCents) },
            { concept: lines.otherIncome, amount: lempiras(summary.otherIncomeCents) },
            { concept: lines.expenses, amount: lempiras(-summary.expensesCents) },
            { concept: lines.net, amount: lempiras(summary.netProfitCents) },
          ],
        },
        {
          name: copy.expensesSheet,
          columns: categoryColumns,
          rows: byCategory(summary.expenseLines),
        },
        { name: copy.incomeSheet, columns: categoryColumns, rows: byCategory(summary.incomeLines) },
      ],
    };
  }

  const filters: EntryFilters = {
    range,
    includeVoided: params.anulados === "1",
    limit: 100_000,
  };
  if ((FINANCE_ENTRY_TYPES as readonly string[]).includes(params.tipo ?? "")) {
    filters.type = params.tipo as FinanceType;
  }
  if ((ALL_PAYMENT_METHODS as readonly string[]).includes(params.pago ?? "")) {
    filters.paidWith = params.pago as PaymentMethod;
  }
  if (params.categoria) {
    filters.categoryId = params.categoria;
  }
  const { rows } = await listFinanceEntries(filters);
  const c = copy.columns;
  return {
    fileBase: `finanzas-movimientos-${period}`,
    sheets: [
      {
        name: copy.entriesSheet,
        primary: true,
        columns: [
          col(c.date, "date", "text", 12),
          col(c.type, "type", "text", 10),
          col(c.category, "category", "text", 28),
          col(c.description, "description", "text", 44),
          col(c.payment, "payment", "text", 22),
          col(c.supplier, "supplier", "text", 24),
          col(c.amount, "amount", "money", 16),
          col(c.status, "status", "text", 12),
          col(c.voidReason, "voidReason", "text", 30),
          col(c.voidedBy, "voidedBy", "text", 20),
          col(c.createdBy, "createdBy", "text", 20),
        ],
        rows: rows.map((row) => ({
          date: formatLocalDate(row.occurredAt),
          type: messages.finance.types[row.type],
          category: row.categoryName,
          description: row.description,
          payment: messages.finance.payments[row.paidWith],
          supplier: row.supplierName,
          amount: lempiras(row.amountCents),
          status: row.voidedAt ? copy.status.voided : copy.status.active,
          voidReason: row.voidReason,
          voidedBy: row.voidedByName,
          createdBy: row.createdByName,
        })),
      },
    ],
  };
}
