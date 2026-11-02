import ExcelJS from "exceljs";

import { parseCsv } from "./csv";
import { IMPORT_MAX_ROWS } from "./plan";
import { IMPORT_MAX_COLUMNS } from "./zip-guard";

export type UploadedFile = { name: string; size: number; bytes: Uint8Array };

export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;

/** La hoja declara más filas o columnas de las que admite la importación: se rechaza antes de recorrerla. */
export class SpreadsheetTooBigError extends Error {
  constructor() {
    super("La hoja declara más filas o columnas de las admitidas");
    this.name = "SpreadsheetTooBigError";
  }
}

/** Texto de una celda de Excel, sea número, fórmula, texto con formato o fecha. */
function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "object") {
    if ("richText" in value) {
      return value.richText.map((part) => part.text).join("");
    }
    if ("result" in value) {
      return cellText(value.result as ExcelJS.CellValue);
    }
    if ("text" in value) {
      return String(value.text);
    }
    return "";
  }
  return String(value);
}

function decodeCsv(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // El CSV de Excel en español suele guardarse en Windows-1252.
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

export function fileKind(name: string): "csv" | "xlsx" | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".csv")) {
    return "csv";
  }
  return lower.endsWith(".xlsx") ? "xlsx" : null;
}

/** Lee un .csv o .xlsx como filas de texto; la fila 1 son los títulos y los números de línea coinciden con los del archivo. */
export async function readTable(file: UploadedFile): Promise<string[][]> {
  if (fileKind(file.name) === "csv") {
    return parseCsv(decodeCsv(file.bytes));
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(file.bytes) as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return [];
  }
  // Una hoja puede decir que llega hasta la fila 1 000 000 con un archivo diminuto: recorrerla colgaría la aplicación entera.
  if (sheet.rowCount > IMPORT_MAX_ROWS + 100 || sheet.columnCount > IMPORT_MAX_COLUMNS) {
    throw new SpreadsheetTooBigError();
  }
  const rows: string[][] = [];
  for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const cells: string[] = [];
    for (let column = 1; column <= sheet.columnCount; column += 1) {
      cells.push(cellText(row.getCell(column).value).trim());
    }
    rows.push(cells);
  }
  return rows;
}
