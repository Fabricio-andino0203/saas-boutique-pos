import { toSVG } from "bwip-js/node";

import { isValidEan13 } from "@/lib/barcode";

export type BarcodeKind = "ean13" | "code128";

/** Un EAN-13 válido se imprime como EAN-13; cualquier otro código (el de un proveedor, por ejemplo) como Code 128. */
export function barcodeKind(code: string): BarcodeKind {
  return isValidEan13(code) ? "ean13" : "code128";
}

/**
 * Código de barras escaneable como SVG (se ajusta al ancho de su contenedor). Con texto legible debajo.
 * El texto solo puede llevar caracteres imprimibles ASCII; cualquier otra cosa lanza un error.
 */
export function barcodeSvg(code: string): string {
  if (!/^[\x20-\x7E]{1,48}$/.test(code)) {
    throw new Error("Barcode text must be 1 to 48 printable ASCII characters");
  }
  return toSVG({
    bcid: barcodeKind(code),
    text: code,
    scale: 2,
    height: 10,
    includetext: true,
    textxalign: "center",
    textsize: 8,
    paddingwidth: 2,
  });
}
