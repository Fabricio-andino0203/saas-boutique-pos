import type { Prisma } from "@/generated/prisma/client";

/** Documentos con numeración correlativa interna (tabla `DocumentCounter`). */
export const DOCUMENT_PREFIX = {
  SALE: "T",
  RETURN: "DV",
  LAYAWAY: "AP",
  PURCHASE_ORDER: "OC",
  GOODS_RECEIPT: "RC",
} as const;

export type DocumentKey = keyof typeof DOCUMENT_PREFIX;

/** `OC-000042`: prefijo, guion y número con ceros a la izquierda (más dígitos si hace falta). */
export function formatDocumentNumber(prefix: string, value: number, width = 6): string {
  return `${prefix}-${String(value).padStart(width, "0")}`;
}

/**
 * Siguiente número del documento, correlativo y sin saltos (CLAUDE.md §6.8). Solo funciona dentro de
 * la transacción del documento: el contador se incrementa con bloqueo de fila, así que dos
 * transacciones nunca reciben el mismo número, y si la transacción se revierte el número se reutiliza.
 */
export async function nextDocumentValue(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  key: DocumentKey,
): Promise<number> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "DocumentCounter" ("key", "nextValue", "updatedAt")
    VALUES (${key}, 2, now())
    ON CONFLICT ("key") DO UPDATE
      SET "nextValue" = "DocumentCounter"."nextValue" + 1, "updatedAt" = now()
    RETURNING ("nextValue" - 1)::int AS "value"
  `;
  const value = rows[0]?.value;
  if (value === undefined) {
    throw new Error(`No se pudo asignar un número para ${key}`);
  }
  return value;
}

export async function nextDocumentNumber(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  key: DocumentKey,
): Promise<string> {
  return formatDocumentNumber(DOCUMENT_PREFIX[key], await nextDocumentValue(tx, key));
}
