import ExcelJS from "exceljs";

import { messages } from "@/config/messages.es";
import { APP_TIME_ZONE, localDateKey } from "@/lib/dates";
import { hasCapability, type Capability, type Role } from "@/lib/permissions";
import { toCsvLine } from "@/modules/products/import/csv";
import { reportAccess } from "@/modules/reports/access";
import { formatHour, formatPeriodKey } from "@/modules/reports/labels";
import {
  getCashClosings,
  getDeadStock,
  getInventoryValuation,
  getSalesByCashier,
  getSalesByDimension,
  getSalesByHour,
  getSalesByMethod,
  getSalesByPeriod,
  getSalesSummary,
  getSizeColorMatrix,
  listProductSales,
  listReportCategories,
  rankProducts,
} from "@/modules/reports/queries";
import { daysInRange, parseRange } from "@/modules/reports/ranges";

/**
 * Exportación de reportes a Excel (.xlsx) y CSV. Cada exportación usa las mismas consultas que la pantalla y el mismo
 * acceso (`reportAccess`): sin `report.financial` ni siquiera se consultan los costos, así que sus columnas no existen
 * en el archivo; y un cajero recibe solo sus ventas.
 */

export const EXPORT_KINDS = ["ventas", "productos", "tallas", "cierres", "inventario"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export type CellKind = "text" | "int" | "decimal" | "money" | "percent" | "datetime";
export type CellValue = string | number | Date | null;

export type ExportColumn = { header: string; key: string; kind: CellKind; width?: number };
export type ExportSheet = {
  name: string;
  columns: ExportColumn[];
  rows: Record<string, CellValue>[];
};
export type ExportTable = {
  /** Nombre del archivo, sin extensión. */
  fileBase: string;
  /** Las hojas; la primera con `primary` es la que lleva el CSV. */
  sheets: (ExportSheet & { primary?: boolean })[];
};

export type ExportParams = Partial<
  Record<"rango" | "desde" | "hasta" | "por" | "orden" | "categoria" | "dias" | "parte", string>
>;

const NEEDS: Record<ExportKind, Capability> = {
  ventas: "report.view",
  productos: "report.view",
  tallas: "report.view",
  cierres: "cash.viewOthers",
  inventario: "report.financial",
};

const copy = messages.reports;
const methodName = (method: string): string =>
  messages.cash.methods[method as keyof typeof messages.cash.methods] ?? method;

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

export function isExportKind(value: string): value is ExportKind {
  return (EXPORT_KINDS as readonly string[]).includes(value);
}

/**
 * La tabla que se exporta, o `null` si esa persona no puede ver ese reporte (la ruta responde como si no existiera).
 */
export async function buildExport(
  kind: ExportKind,
  params: ExportParams,
  user: { id: string; role: Role },
  now: Date = new Date(),
): Promise<ExportTable | null> {
  if (!hasCapability(user.role, "report.view") || !hasCapability(user.role, NEEDS[kind])) {
    return null;
  }
  const access = reportAccess(user);
  const range = parseRange({ rango: params.rango, desde: params.desde, hasta: params.hasta }, now);
  const period = `${range.fromKey}_${range.toKey}`;

  if (kind === "ventas") {
    return exportSales(params, range, access, period);
  }
  if (kind === "productos") {
    const order = params.orden === "menos" ? "worst" : "best";
    const all = await listProductSales(range, daysInRange(range), access.scope);
    const rows = rankProducts(all, order, 200);
    const c = copy.products.columns;
    return {
      fileBase: `reporte-productos-${order === "best" ? "mas" : "menos"}-vendidos-${period}`,
      sheets: [
        {
          name: copy.products.title,
          primary: true,
          columns: [
            col(c.product, "name", "text", 34),
            col("Código", "code", "text", 14),
            col(c.category, "category", "text", 20),
            col(c.units, "units", "int", 16),
            col(c.sales, "sales", "money", 16),
            col(c.onHand, "onHand", "int", 12),
            col(c.rotation, "rotation", "decimal", 12),
            col(c.days, "days", "int", 18),
          ],
          rows: rows.map((row) => ({
            name: row.name,
            code: row.code,
            category: row.categoryName,
            units: row.netUnits,
            sales: lempiras(row.soldCents),
            onHand: row.onHand,
            rotation: row.rotation,
            days: row.daysOfStock,
          })),
        },
      ],
    };
  }
  if (kind === "tallas") {
    const categories = await listReportCategories();
    const categoryId = categories.some((category) => category.id === params.categoria)
      ? params.categoria
      : undefined;
    const matrix = await getSizeColorMatrix(range, access.scope, categoryId);
    const cells = new Map(
      matrix.cells.map((cell) => [`${cell.sizeId}|${cell.colorId}`, cell.units]),
    );
    return {
      fileBase: `reporte-tallas-colores-${period}`,
      sheets: [
        {
          name: copy.sizes.title,
          primary: true,
          columns: [
            col(copy.sizes.size, "size", "text", 12),
            ...matrix.colors.map((color) => col(color.name, color.id, "int", 12)),
          ],
          rows: matrix.sizes.map((size) => ({
            size: size.name,
            ...Object.fromEntries(
              matrix.colors.map((color) => [color.id, cells.get(`${size.id}|${color.id}`) ?? 0]),
            ),
          })),
        },
      ],
    };
  }
  if (kind === "cierres") {
    const closings = await getCashClosings(range);
    const c = copy.closings.columns;
    return {
      fileBase: `reporte-cierres-de-caja-${period}`,
      sheets: [
        {
          name: copy.closings.title,
          primary: true,
          columns: [
            col(c.closedAt, "closedAt", "datetime", 18),
            col(c.terminal, "terminal", "text", 14),
            col(c.user, "user", "text", 22),
            col(c.expected, "expected", "money", 16),
            col(c.counted, "counted", "money", 16),
            col(c.difference, "difference", "money", 16),
            col(c.status, "status", "text", 14),
          ],
          rows: closings.rows.map((row) => ({
            closedAt: row.closedAt,
            terminal: row.terminalName,
            user: row.userName,
            expected: lempiras(row.expectedCents),
            counted: lempiras(row.countedCents),
            difference: lempiras(row.differenceCents),
            status: copy.closings.status[row.status],
          })),
        },
      ],
    };
  }
  // inventario: valoración y, aparte, lo que no se mueve
  const valuation = await getInventoryValuation();
  const parsedDays = Number.parseInt(params.dias ?? "", 10);
  const days = Number.isFinite(parsedDays) ? Math.min(Math.max(parsedDays, 1), 730) : 90;
  const dead = await getDeadStock(days, now, 5000);
  const v = copy.inventory.valuation;
  const d = copy.inventory.dead;
  return {
    fileBase: `reporte-inventario-${localDateKey(now)}`,
    sheets: [
      {
        name: v.title,
        primary: params.parte !== "sinmovimiento",
        columns: [
          col(v.category, "category", "text", 24),
          col(v.units, "units", "int", 12),
          col(v.cost, "cost", "money", 18),
          col(v.retail, "retail", "money", 20),
        ],
        rows: [
          ...valuation.rows.map((row) => ({
            category: row.categoryName,
            units: row.units,
            cost: lempiras(row.costValueCents),
            retail: lempiras(row.retailValueCents),
          })),
          {
            category: v.total,
            units: valuation.units,
            cost: lempiras(valuation.costValueCents),
            retail: lempiras(valuation.retailValueCents),
          },
        ],
      },
      {
        name: d.title,
        primary: params.parte === "sinmovimiento",
        columns: [
          col(d.product, "product", "text", 34),
          col("Talla", "size", "text", 10),
          col("Color", "color", "text", 14),
          col(d.sku, "sku", "text", 18),
          col(d.onHand, "onHand", "int", 12),
          col(d.last, "last", "datetime", 18),
          col(d.value, "value", "money", 18),
        ],
        rows: dead.rows.map((row) => ({
          product: row.productName,
          size: row.sizeName,
          color: row.colorName,
          sku: row.sku,
          onHand: row.onHand,
          last: row.lastSaleAt ?? copy.inventory.dead.never,
          value: lempiras(row.costValueCents),
        })),
      },
    ],
  };
}

async function exportSales(
  params: ExportParams,
  range: ReturnType<typeof parseRange>,
  access: ReturnType<typeof reportAccess>,
  period: string,
): Promise<ExportTable> {
  const view = ["periodo", "hora", "cajero", "categoria", "marca", "metodo"].includes(
    params.por ?? "",
  )
    ? (params.por as string)
    : "periodo";
  const summary = await getSalesSummary(range, access.scope, access.withCosts);
  const s = copy.summary;
  const summarySheet: ExportSheet = {
    name: "Resumen",
    columns: [
      col(s.sales, "sales", "money", 16),
      col(s.returns, "returns", "money", 16),
      col(s.net, "net", "money", 16),
      col(s.tickets, "tickets", "int", 10),
      col(s.average, "average", "money", 16),
      col(s.units, "units", "int", 16),
      ...(summary.financial
        ? [
            col(s.revenue, "revenue", "money", 18),
            col(s.cost, "cost", "money", 14),
            col(s.profit, "profit", "money", 16),
            col(s.margin, "margin", "percent", 10),
          ]
        : []),
    ],
    rows: [
      {
        sales: lempiras(summary.salesCents),
        returns: lempiras(summary.returnsCents),
        net: lempiras(summary.netCents),
        tickets: summary.tickets,
        average: lempiras(summary.averageTicketCents),
        units: summary.unitsSold,
        ...(summary.financial
          ? {
              revenue: lempiras(summary.financial.revenueCents),
              cost: lempiras(summary.financial.costCents),
              profit: lempiras(summary.financial.profitCents),
              margin: summary.financial.marginBps / 10_000,
            }
          : {}),
      },
    ],
  };
  const c = copy.sales.columns;
  const fileBase = `reporte-ventas-${view}-${period}`;
  const data = (sheet: Omit<ExportSheet, "name"> & { name?: string }): ExportTable => ({
    fileBase,
    sheets: [
      summarySheet,
      { name: copy.sales.by[viewKey(view)], primary: true, ...sheet } as ExportSheet & {
        primary: boolean;
      },
    ],
  });

  if (view === "hora") {
    const rows = await getSalesByHour(range, access.scope);
    return data({
      columns: [
        col(c.hour, "hour", "text", 10),
        col(c.tickets, "tickets", "int", 10),
        col(c.sales, "sales", "money", 16),
      ],
      rows: rows.map((row) => ({
        hour: formatHour(row.hour),
        tickets: row.tickets,
        sales: lempiras(row.salesCents),
      })),
    });
  }
  if (view === "cajero") {
    const rows = await getSalesByCashier(range, access.scope);
    return data({
      columns: [
        col(c.cashier, "cashier", "text", 24),
        col(c.tickets, "tickets", "int", 10),
        col(c.sales, "sales", "money", 16),
        col(c.average, "average", "money", 16),
      ],
      rows: rows.map((row) => ({
        cashier: row.sellerName,
        tickets: row.tickets,
        sales: lempiras(row.salesCents),
        average: lempiras(row.averageTicketCents),
      })),
    });
  }
  if (view === "metodo") {
    const result = await getSalesByMethod(range, access.scope);
    return data({
      columns: [
        col(c.method, "method", "text", 24),
        col(c.tickets, "tickets", "int", 10),
        col(c.amount, "amount", "money", 16),
      ],
      rows: result.methods.map((row) => ({
        method: methodName(row.method),
        tickets: row.tickets,
        amount: lempiras(row.amountCents),
      })),
    });
  }
  if (view === "categoria" || view === "marca") {
    const dimension = view === "categoria" ? "category" : "brand";
    const rows = await getSalesByDimension(range, dimension, access.scope, access.withCosts);
    const withMoney = rows.some((row) => row.financial !== null);
    return data({
      columns: [
        col(dimension === "category" ? c.category : c.brand, "name", "text", 26),
        col(c.units, "units", "int", 10),
        col(c.sales, "sold", "money", 16),
        col(c.returns, "returned", "money", 16),
        col(c.net, "net", "money", 16),
        ...(withMoney
          ? [
              col(c.revenue, "revenue", "money", 18),
              col("Costo", "cost", "money", 14),
              col(c.profit, "profit", "money", 16),
              col(c.margin, "margin", "percent", 10),
            ]
          : []),
      ],
      rows: rows.map((row) => ({
        name: row.name || copy.common.noBrand,
        units: row.units,
        sold: lempiras(row.soldCents),
        returned: lempiras(row.returnedCents),
        net: lempiras(row.netCents),
        ...(row.financial
          ? {
              revenue: lempiras(row.financial.revenueCents),
              cost: lempiras(row.financial.costCents),
              profit: lempiras(row.financial.profitCents),
              margin: row.financial.marginBps / 10_000,
            }
          : {}),
      })),
    });
  }
  const granularity = daysInRange(range) > 62 ? "month" : "day";
  const rows = await getSalesByPeriod(range, granularity, access.scope);
  return data({
    columns: [
      col(c.period, "period", "text", 16),
      col(c.tickets, "tickets", "int", 10),
      col(c.sales, "sales", "money", 16),
      col(c.returns, "returns", "money", 16),
      col(c.net, "net", "money", 16),
    ],
    rows: rows.map((row) => ({
      period: formatPeriodKey(row.key),
      tickets: row.tickets,
      sales: lempiras(row.salesCents),
      returns: lempiras(row.returnsCents),
      net: lempiras(row.netCents),
    })),
  });
}

function viewKey(view: string): keyof typeof copy.sales.by {
  const map: Record<string, keyof typeof copy.sales.by> = {
    periodo: "period",
    hora: "hour",
    cajero: "cashier",
    categoria: "category",
    marca: "brand",
    metodo: "method",
  };
  return map[view] ?? "period";
}

// ───────────── Escritura ─────────────

/** Las partes de una fecha en hora de Honduras. */
function localParts(date: Date): {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
  s: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    y: get("year"),
    m: get("month"),
    d: get("day"),
    h: get("hour"),
    mi: get("minute"),
    s: get("second"),
  };
}

const pad = (value: number) => String(value).padStart(2, "0");

/** `2026-10-27 14:05`, hora de Honduras. */
function formatLocalStamp(date: Date): string {
  const p = localParts(date);
  return `${p.y}-${pad(p.m)}-${pad(p.d)} ${pad(p.h)}:${pad(p.mi)}`;
}

/** Excel guarda las fechas sin zona: se entrega la hora de pared de Honduras como si fuera UTC. */
function wallClock(date: Date): Date {
  const p = localParts(date);
  return new Date(Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s));
}

function csvCell(value: CellValue, kind: CellKind): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (value instanceof Date) {
    return formatLocalStamp(value);
  }
  if (typeof value === "number") {
    if (kind === "money") {
      return value.toFixed(2);
    }
    if (kind === "percent") {
      return `${(value * 100).toFixed(2)}%`;
    }
    if (kind === "decimal") {
      return value.toFixed(2);
    }
    return String(value);
  }
  return value;
}

/** El CSV de la hoja principal: UTF-8 con BOM (Excel respeta las tildes), comas, saltos de línea de Windows. */
export function toCsv(table: ExportTable): string {
  const sheet =
    table.sheets.find((candidate) => candidate.primary) ?? (table.sheets[0] as ExportSheet);
  const lines = [
    toCsvLine(sheet.columns.map((column) => column.header)),
    ...sheet.rows.map((row) =>
      toCsvLine(sheet.columns.map((column) => csvCell(row[column.key] ?? null, column.kind))),
    ),
  ];
  return `﻿${lines.join("\r\n")}\r\n`;
}

const FORMATS: Record<CellKind, string | undefined> = {
  text: undefined,
  int: "#,##0",
  decimal: "0.00",
  money: '"L" #,##0.00;[Red]-"L" #,##0.00',
  percent: "0.00%",
  datetime: "dd/mm/yyyy hh:mm",
};

/** El libro de Excel con una hoja por tabla, encabezado en negrita, filtros, columnas con formato y la primera fila fija. */
export async function toXlsx(table: ExportTable): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Boutique POS";
  for (const sheet of table.sheets) {
    const worksheet = workbook.addWorksheet(sheet.name.slice(0, 31));
    worksheet.columns = sheet.columns.map((column) => ({
      header: column.header,
      key: column.key,
      width: column.width ?? Math.max(12, column.header.length + 4),
      style: FORMATS[column.kind] ? { numFmt: FORMATS[column.kind] } : {},
    }));
    for (const row of sheet.rows) {
      worksheet.addRow(
        Object.fromEntries(
          sheet.columns.map((column) => {
            const value = row[column.key] ?? null;
            return [column.key, value instanceof Date ? wallClock(value) : value];
          }),
        ),
      );
    }
    worksheet.getRow(1).font = { bold: true };
    worksheet.views = [{ state: "frozen", ySplit: 1 }];
    if (sheet.rows.length > 0) {
      worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: sheet.columns.length },
      };
    }
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
