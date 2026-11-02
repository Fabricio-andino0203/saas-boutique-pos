/**
 * Cómo se entiende el nombre de un archivo en la carga masiva de fotos: empieza con el **código del producto**, y lo que
 * sigue puede ser un número de orden o el color de la foto:
 *
 *   VES-001.jpg        → producto VES-001
 *   VES-001_2.jpg      → producto VES-001 (su segunda foto)
 *   VES-001 (3).jpg    → producto VES-001
 *   VES-001_rojo.jpg   → producto VES-001, foto del color Rojo (si el producto lo tiene)
 *
 * Sin código de barras ni nada oculto: solo texto que cualquiera puede escribir al nombrar sus archivos. Aquí no se toca la
 * base; solo se proponen candidatos, y el servidor decide cuál existe.
 */

export type NameCandidate = { code: string; rest: string };

const SEPARATOR = /[\s_-]/;
const MAX_CANDIDATES = 8;

/** El nombre sin carpeta ni extensión. */
export function baseName(fileName: string): string {
  const file = fileName.split(/[\\/]/).pop() ?? "";
  return file.replace(/\.[^.]+$/, "").trim();
}

/**
 * Los códigos que podría ser, del más largo al más corto: primero el nombre completo (un código puede traer guiones, como
 * `CAM-001`), luego cada corte en un espacio, guion o guion bajo con lo que queda como `rest`.
 */
export function candidatesFromFileName(fileName: string): NameCandidate[] {
  const base = baseName(fileName);
  if (base === "") {
    return [];
  }
  const candidates: NameCandidate[] = [{ code: base, rest: "" }];
  for (let index = base.length - 1; index > 0; index -= 1) {
    if (SEPARATOR.test(base[index] as string)) {
      const code = base.slice(0, index).trim();
      const rest = base
        .slice(index + 1)
        .replace(/^[\s_-]+/, "")
        .trim();
      if (code !== "" && !candidates.some((candidate) => candidate.code === code)) {
        candidates.push({ code, rest });
      }
    }
  }
  return candidates.slice(0, MAX_CANDIDATES);
}

/** Minúsculas y sin tildes, para comparar «Azul» con «azul» y «Púrpura» con «purpura». */
export function normalizeName(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

/**
 * Si lo que sigue al código nombra uno de los colores del producto, ese color. Un número (orden), un texto que no es color
 * («espalda») o nada, no asignan color: la foto queda como general del producto.
 */
export function colorFromRest<T extends { name: string }>(
  rest: string,
  colors: readonly T[],
): T | null {
  const text = words(rest);
  if (text === "" || /^\d+$/.test(text)) {
    return null;
  }
  const pieces = text.split(" ");
  const byLength = [...colors].sort((a, b) => b.name.length - a.name.length);
  return (
    byLength.find((color) => {
      const name = words(color.name);
      return text === name || text.startsWith(`${name} `) || pieces.includes(name);
    }) ?? null
  );
}

/** Minúsculas, sin tildes y con guiones, guiones bajos y paréntesis convertidos en espacios simples. */
function words(text: string): string {
  return normalizeName(text.replace(/[()[\]_-]/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** Orden natural de archivos, sin contar la extensión: `VES` y `VES_2` antes que `VES_10`. */
export function compareFileNames(a: string, b: string): number {
  const options = { numeric: true, sensitivity: "base" } as const;
  return baseName(a).localeCompare(baseName(b), "es", options) || a.localeCompare(b, "es", options);
}
