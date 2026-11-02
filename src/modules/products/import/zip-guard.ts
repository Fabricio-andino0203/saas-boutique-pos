/**
 * Defensa contra los «archivos bomba»: un .xlsx es un zip, y un zip de 5 MB puede declarar cientos de megabytes (o miles de
 * millones de filas) una vez descomprimido. Con varios negocios en la misma aplicación, un archivo así tumbaría la memoria o la
 * CPU de TODOS. Se mira el índice del zip (sin descomprimir nada) y se rechaza lo que declare más de lo razonable.
 *
 * Un archivo de productos real ocupa unos pocos cientos de kilobytes descomprimido; el tope es muy generoso.
 */

export const IMPORT_MAX_UNZIPPED_BYTES = 30 * 1024 * 1024;
export const IMPORT_MAX_ZIP_ENTRIES = 300;
/** Columnas que se leen de la hoja: el modelo de importación tiene unas 25; más que esto es un archivo ajeno o malicioso. */
export const IMPORT_MAX_COLUMNS = 60;

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
/** Un campo de 32 bits en esta marca significa «mira el formato ZIP64»: nadie lo necesita para una hoja de productos. */
const ZIP64_MARKER = 0xffffffff;

export type ZipSummary = { entries: number; unzippedBytes: number };

/**
 * El resumen del índice de un zip; `null` si no es un zip legible; `"zip64"` si usa el formato ZIP64 (sus tamaños no caben en 32
 * bits: nunca es una hoja de productos normal y no se puede medir aquí).
 */
export function inspectZip(bytes: Uint8Array): ZipSummary | "zip64" | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // El final del zip tiene un registro fijo de 22 bytes, seguido de un comentario de hasta 65 535: se busca desde atrás.
  let end = -1;
  const lowest = Math.max(0, bytes.byteLength - 22 - 0xffff);
  for (let index = bytes.byteLength - 22; index >= lowest; index -= 1) {
    if (view.getUint32(index, true) === END_OF_CENTRAL_DIRECTORY) {
      end = index;
      break;
    }
  }
  if (end === -1) {
    return null;
  }
  const entries = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true);
  const directoryOffset = view.getUint32(end + 16, true);
  if (entries === 0xffff || directorySize === ZIP64_MARKER || directoryOffset === ZIP64_MARKER) {
    return "zip64";
  }
  if (directoryOffset + directorySize > bytes.byteLength) {
    return null;
  }

  let unzippedBytes = 0;
  let cursor = directoryOffset;
  for (let counted = 0; counted < entries; counted += 1) {
    if (
      cursor + 46 > bytes.byteLength ||
      view.getUint32(cursor, true) !== CENTRAL_DIRECTORY_ENTRY
    ) {
      return null;
    }
    const uncompressed = view.getUint32(cursor + 24, true);
    if (uncompressed === ZIP64_MARKER) {
      return "zip64";
    }
    unzippedBytes += uncompressed;
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return { entries, unzippedBytes };
}

export type WorkbookVerdict = "ok" | "too-big" | "not-a-zip";

/**
 * Qué hacer con un `.xlsx` ANTES de abrirlo con la biblioteca: `ok` (declara poco), `too-big` (declara más de lo razonable, o usa
 * ZIP64) o `not-a-zip` (no es un zip: la biblioteca no lo va a poder leer y se le dirá a la persona que está dañado).
 */
export function workbookVerdict(bytes: Uint8Array): WorkbookVerdict {
  const summary = inspectZip(bytes);
  if (summary === null) {
    return "not-a-zip";
  }
  if (
    summary === "zip64" ||
    summary.entries > IMPORT_MAX_ZIP_ENTRIES ||
    summary.unzippedBytes > IMPORT_MAX_UNZIPPED_BYTES
  ) {
    return "too-big";
  }
  return "ok";
}

/** `true` si el archivo es un zip legible que no declara más de lo razonable. */
export function isSafeWorkbook(bytes: Uint8Array): boolean {
  return workbookVerdict(bytes) === "ok";
}
