/** Elige el separador más usado en la primera línea: coma, punto y coma (Excel en español) o tabulador. */
export function detectDelimiter(text: string): "," | ";" | "\t" {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const count = (char: string) => firstLine.split(char).length - 1;
  const candidates = [
    { char: ",", count: count(",") },
    { char: ";", count: count(";") },
    { char: "\t", count: count("\t") },
  ] as const;
  const best = candidates.reduce((top, item) => (item.count > top.count ? item : top));
  return best.count === 0 ? "," : best.char;
}

/** Lector de CSV (RFC 4180): comillas dobles, comillas escapadas ("") y saltos de línea dentro de comillas. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  const endCell = () => {
    row.push(cell);
    cell = "";
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      endCell();
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") {
        index += 1;
      }
      endRow();
    } else {
      cell += char;
    }
  }
  if (cell !== "" || row.length > 0) {
    endRow();
  }
  return rows;
}

/** Escribe una fila de CSV: pone comillas solo cuando el valor las necesita. */
export function toCsvLine(values: readonly string[]): string {
  return values
    .map((value) => (/[",\r\n;\t]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value))
    .join(",");
}
