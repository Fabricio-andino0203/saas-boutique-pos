import type { Prisma } from "@/generated/prisma/client";
import { endOfLocalDay } from "@/lib/dates";
import { FiscalRangeExhaustedError } from "@/lib/errors";

type Tx = Prisma.TransactionClient;

export type IssuedFiscalDocument = {
  type: "INVOICE";
  rangeId: string;
  /** Número dentro del rango (el que se guarda en la venta). */
  number: number;
  /** Como se imprime: prefijo + 8 dígitos, p. ej. `000-001-01-00000042`. */
  formattedNumber: string;
  cai: string;
};

export type FiscalDocumentRequest = { terminalId: string; now: Date };

/**
 * Quien emite los documentos fiscales (ARCHITECTURE §8). Hoy es el rango CAI local; si algún día se exige
 * facturación electrónica se agrega otra implementación sin tocar las ventas. Debe llamarse dentro de la
 * transacción de la venta: si esta se revierte, el número no se consume.
 */
export interface FiscalDocumentIssuer {
  issue(tx: Tx, request: FiscalDocumentRequest): Promise<IssuedFiscalDocument>;
}

export function formatFiscalNumber(prefix: string, number: number): string {
  return `${prefix}${String(number).padStart(8, "0")}`;
}

type LockedRange = {
  id: string;
  prefix: string;
  cai: string;
  rangeEnd: number;
  nextNumber: number;
  expiresAt: Date;
};

/**
 * Emite la siguiente factura del rango CAI activo (el de la terminal, o el general si no tiene uno propio).
 * El rango se bloquea mientras se toma el número, así dos cajas nunca reciben el mismo. No emite si el rango
 * venció (vale hasta el final del día de su fecha límite) o se agotó.
 */
export const caiRangeIssuer: FiscalDocumentIssuer = {
  async issue(tx, { terminalId, now }) {
    const [range] = await tx.$queryRaw<LockedRange[]>`
      SELECT "id", "prefix", "cai", "rangeEnd", "nextNumber", "expiresAt"
      FROM "FiscalRange"
      WHERE "documentType" = 'INVOICE'
        AND "isActive"
        AND ("terminalId" = ${terminalId} OR "terminalId" IS NULL)
      ORDER BY ("terminalId" IS NULL) ASC
      LIMIT 1
      FOR UPDATE
    `;
    if (!range) {
      throw new FiscalRangeExhaustedError("There is no active invoice range");
    }
    if (now > endOfLocalDay(range.expiresAt)) {
      throw new FiscalRangeExhaustedError("The invoice range has expired");
    }
    if (range.nextNumber > range.rangeEnd) {
      throw new FiscalRangeExhaustedError("The invoice range is exhausted");
    }
    await tx.fiscalRange.update({
      where: { id: range.id },
      data: { nextNumber: range.nextNumber + 1 },
    });
    return {
      type: "INVOICE",
      rangeId: range.id,
      number: range.nextNumber,
      formattedNumber: formatFiscalNumber(range.prefix, range.nextNumber),
      cai: range.cai,
    };
  },
};
