import { ValidationError } from "@/lib/errors";

/** Dígito de control EAN-13 de los 12 primeros dígitos (pesos 1 y 3 alternados desde la izquierda). */
export function ean13CheckDigit(body: string): number {
  if (!/^\d{12}$/.test(body)) {
    throw new ValidationError("EAN-13 body must have exactly 12 digits");
  }
  let sum = 0;
  for (let index = 0; index < 12; index += 1) {
    sum += Number(body[index]) * (index % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

/** Código interno: `prefijo` + `serie` rellena con ceros hasta 12 dígitos + dígito de control. */
export function buildEan13(prefix: string, serial: number): string {
  if (!/^\d{1,6}$/.test(prefix)) {
    throw new ValidationError("Barcode prefix must have 1 to 6 digits");
  }
  const serialLength = 12 - prefix.length;
  if (!Number.isSafeInteger(serial) || serial < 0 || String(serial).length > serialLength) {
    throw new ValidationError("Barcode serial is out of range");
  }
  const body = `${prefix}${String(serial).padStart(serialLength, "0")}`;
  return `${body}${ean13CheckDigit(body)}`;
}
