import type { PrismaClient } from "@/generated/prisma/client";
import { startOfLocalDay } from "@/lib/dates";
import { getSetting } from "@/lib/settings";

const DAY_MS = 86_400_000;

export type ReturnPolicyState = {
  /** Días que la tienda da para devolver (ajuste `returns.maxDays`). */
  maxDays: number;
  /** Días de calendario (hora de Honduras) entre la venta y hoy. */
  daysSince: number;
  outsideWindow: boolean;
  /** Prendas cuya categoría (o la de un nivel superior) no admite devoluciones. */
  blockedVariantIds: Set<string>;
};

type Reader = Pick<PrismaClient, "setting" | "variant" | "product" | "category">;

/**
 * Qué dice la política de devoluciones de esta venta: si ya pasó el plazo y qué prendas son de una categoría que no
 * admite devoluciones. Las consultas van en fila para poder usarse dentro de una transacción.
 */
export async function evaluateReturnPolicy(
  client: Reader,
  input: { saleCreatedAt: Date; variantIds: string[]; now?: Date },
): Promise<ReturnPolicyState> {
  const now = input.now ?? new Date();
  const maxDays = await getSetting(client, "returns.maxDays");
  const daysSince = Math.round(
    (startOfLocalDay(now).getTime() - startOfLocalDay(input.saleCreatedAt).getTime()) / DAY_MS,
  );

  const variants = await client.variant.findMany({
    where: { id: { in: input.variantIds } },
    select: { id: true, productId: true },
  });
  const products = await client.product.findMany({
    where: { id: { in: [...new Set(variants.map((variant) => variant.productId))] } },
    select: { id: true, categoryId: true },
  });
  const categories = await client.category.findMany({
    select: { id: true, parentId: true, allowsReturns: true },
  });
  const byId = new Map(categories.map((category) => [category.id, category]));
  const categoryOfProduct = new Map(products.map((product) => [product.id, product.categoryId]));

  const allows = (categoryId: string | null | undefined): boolean => {
    const seen = new Set<string>();
    let current = categoryId ? byId.get(categoryId) : undefined;
    while (current && !seen.has(current.id)) {
      if (!current.allowsReturns) {
        return false;
      }
      seen.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return true;
  };

  const blocked = new Set<string>();
  for (const variant of variants) {
    if (!allows(categoryOfProduct.get(variant.productId))) {
      blocked.add(variant.id);
    }
  }
  return { maxDays, daysSince, outsideWindow: daysSince > maxDays, blockedVariantIds: blocked };
}
