import { messages } from "@/config/messages.es";

export const IMPORT_COLUMN_KEYS = [
  "name",
  "category",
  "price",
  "cost",
  "brand",
  "season",
  "supplier",
  "code",
  "size",
  "color",
  "quantity",
  "barcode",
  "tax",
  "description",
] as const;

export type ImportColumnKey = (typeof IMPORT_COLUMN_KEYS)[number];

export const REQUIRED_COLUMNS: readonly ImportColumnKey[] = ["name", "category", "price"];

/** Otros nombres con los que se reconoce cada columna (ya sin tildes ni mayúsculas). */
const ALIASES: Record<ImportColumnKey, readonly string[]> = {
  name: ["nombre", "nombre del producto"],
  category: [],
  price: ["precio de venta"],
  cost: [],
  brand: [],
  season: [],
  supplier: [],
  code: ["codigo del producto", "codigo de producto", "sku"],
  size: [],
  color: [],
  quantity: ["existencia", "stock", "inventario"],
  barcode: ["barras", "codigo barras"],
  tax: ["isv"],
  description: [],
};

/** Normaliza para comparar: sin tildes, en minúsculas, sin asteriscos y con espacios simples. */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function headerLabel(key: ImportColumnKey): string {
  return messages.products.import.headers[key];
}

/** Devuelve la posición de cada columna reconocida en la fila de títulos. */
export function mapHeaders(headers: readonly string[]): Partial<Record<ImportColumnKey, number>> {
  const found: Partial<Record<ImportColumnKey, number>> = {};
  headers.forEach((header, index) => {
    const name = normalize(header);
    for (const key of IMPORT_COLUMN_KEYS) {
      if (
        found[key] === undefined &&
        (name === normalize(headerLabel(key)) || ALIASES[key].includes(name))
      ) {
        found[key] = index;
      }
    }
  });
  return found;
}
