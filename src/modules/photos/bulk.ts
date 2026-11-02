import type { PrismaClient } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { candidatesFromFileName, colorFromRest } from "@/modules/photos/file-names";
import type { FileMatch } from "@/modules/photos/types";

export type { FileMatch };

/** Cuántos nombres de archivo se emparejan por vez (la pantalla sube de a tandas de este tamaño). */
export const MAX_MATCH_FILES = 100;

/**
 * A qué producto pertenece cada archivo según su nombre (ver `file-names.ts`). Solo productos activos; el código se compara
 * sin importar mayúsculas. Devuelve una respuesta por nombre y en el mismo orden; lo que no se reconoce queda sin producto
 * para que la persona lo vea antes de subir nada.
 */
export async function matchPhotoFileNames(
  names: readonly string[],
  client: PrismaClient = db,
): Promise<FileMatch[]> {
  const list = names.slice(0, MAX_MATCH_FILES).map((name) => String(name).slice(0, 255));
  const candidates = list.map((name) => candidatesFromFileName(name));
  const codes = [
    ...new Set(candidates.flatMap((entries) => entries.map((entry) => entry.code.toLowerCase()))),
  ];
  if (codes.length === 0) {
    return list.map((name) => ({ matched: false, name }));
  }

  const products = await client.$queryRaw<{ id: string; code: string; name: string }[]>`
    SELECT "id", "code", "name" FROM "Product"
    WHERE "archivedAt" IS NULL AND lower("code") = ANY(${codes})
  `;
  const byCode = new Map(products.map((product) => [product.code.toLowerCase(), product]));

  const variants = await client.variant.findMany({
    where: { productId: { in: products.map((product) => product.id) }, colorId: { not: null } },
    select: { productId: true, color: { select: { id: true, name: true } } },
    distinct: ["productId", "colorId"],
  });
  const colorsOf = new Map<string, { id: string; name: string }[]>();
  for (const variant of variants) {
    if (variant.color) {
      colorsOf.set(variant.productId, [...(colorsOf.get(variant.productId) ?? []), variant.color]);
    }
  }

  return list.map((name, index): FileMatch => {
    for (const candidate of candidates[index] ?? []) {
      const product = byCode.get(candidate.code.toLowerCase());
      if (product) {
        const color = colorFromRest(candidate.rest, colorsOf.get(product.id) ?? []);
        return {
          matched: true,
          name,
          productId: product.id,
          productName: product.name,
          code: product.code,
          colorId: color?.id ?? null,
          colorName: color?.name ?? null,
        };
      }
    }
    return { matched: false, name };
  });
}
