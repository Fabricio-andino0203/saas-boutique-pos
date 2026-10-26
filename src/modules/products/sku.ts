/** Parte de un código: sin tildes, en mayúsculas y solo letras y números ("Azul marino" → "AZULMARINO"). */
export function skuPart(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/** `{código}-{talla}-{color}`; omite las partes que no existen. */
export function buildSkuBase(code: string, sizeName?: string | null, colorName?: string | null) {
  return [code, sizeName ? skuPart(sizeName) : "", colorName ? skuPart(colorName) : ""]
    .filter((part) => part !== "")
    .join("-");
}

/** Si el código base ya existe, agrega -2, -3… hasta encontrar uno libre, y lo reserva en `taken`. */
export function uniqueSku(base: string, taken: Set<string>): string {
  let candidate = base;
  for (let suffix = 2; taken.has(candidate); suffix += 1) {
    candidate = `${base}-${suffix}`;
  }
  taken.add(candidate);
  return candidate;
}

/** Clave estable de una celda de la matriz talla × color ("-" = sin talla / sin color). */
export function cellKey(sizeId: string | null, colorId: string | null): string {
  return `${sizeId ?? "-"}:${colorId ?? "-"}`;
}
