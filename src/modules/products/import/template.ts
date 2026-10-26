import ExcelJS from "exceljs";

import { messages } from "@/config/messages.es";

import { headerLabel, IMPORT_COLUMN_KEYS } from "./columns";
import { toCsvLine } from "./csv";

const copy = messages.products.import;

const headers = IMPORT_COLUMN_KEYS.map((key) => headerLabel(key));

/** CSV con solo los títulos (con BOM para que Excel respete las tildes). */
export function buildTemplateCsv(): string {
  return `﻿${toCsvLine(headers)}\r\n`;
}

/** Libro de Excel con la hoja de datos vacía y una hoja que explica cómo llenarla. */
export async function buildTemplateXlsx(): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const data = workbook.addWorksheet(copy.dataSheet);
  data.addRow(headers);
  data.getRow(1).font = { bold: true };
  data.views = [{ state: "frozen", ySplit: 1 }];
  data.columns = headers.map((header) => ({ width: Math.max(14, header.length + 4) }));

  const guide = workbook.addWorksheet(copy.guideSheet);
  guide.getColumn(1).width = 110;
  for (const line of copy.guide) {
    guide.addRow([line]);
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
