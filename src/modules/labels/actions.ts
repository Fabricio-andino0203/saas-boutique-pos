"use server";

import { messages } from "@/config/messages.es";
import { toActionResult } from "@/lib/action-result";
import { requireUserCapability } from "@/lib/auth";
import { LABEL_TEMPLATE_SCHEMA } from "@/lib/settings";
import {
  getProductLabelRows,
  isLabelQuantityMode,
  saveLabelTemplate,
  searchLabelProducts,
  withStock,
  type LabelProductOption,
  type SelectionRow,
} from "@/modules/labels/service";
import {
  listVariantsPage,
  searchPurchasableVariants,
  type VariantOption,
  type VariantPage,
} from "@/modules/purchasing/queries";

/** Una prenda del buscador con las unidades que hay: así se ve el stock antes de pedir las etiquetas. */
export type LabelVariantOption = VariantOption & { onHand: number };
export type LabelVariantPage = { items: LabelVariantOption[]; hasMore: boolean };

export type LabelActionState = { error?: string; success?: string } | undefined;

/**
 * La búsqueda de prendas de la pantalla de etiquetas. Es **suya**, con el permiso de esta pantalla (el mismo de la página):
 * antes reutilizaba la de compras, que exige el módulo «Compras», y en un plan sin él la búsqueda fallaba.
 */
export async function searchLabelVariantsAction(query: string): Promise<LabelVariantOption[]> {
  await requireUserCapability("stock.adjust");
  return withStock(await searchPurchasableVariants(String(query), { includeCost: false }));
}

/** Todas las prendas, de a páginas, para elegir mirando la lista. */
export async function browseLabelVariantsAction(offset: number): Promise<LabelVariantPage> {
  await requireUserCapability("stock.adjust");
  const page: VariantPage = await listVariantsPage(Number(offset), { includeCost: false });
  return { hasMore: page.hasMore, items: await withStock(page.items) };
}

/** Busca productos para sacar las etiquetas de todas sus prendas de una vez. */
export async function searchLabelProductsAction(query: string): Promise<LabelProductOption[]> {
  await requireUserCapability("stock.adjust");
  return searchLabelProducts(String(query));
}

/**
 * Todas las prendas de un producto con las etiquetas que pide el modo elegido: `one` (una de cada una) o `stock` (las que hay).
 * La cantidad es una comodidad: se puede cambiar antes de imprimir.
 */
export async function getProductLabelRowsAction(
  productId: string,
  quantity: string,
): Promise<SelectionRow[]> {
  await requireUserCapability("stock.adjust");
  return getProductLabelRows(String(productId), isLabelQuantityMode(quantity) ? quantity : "one");
}

export async function saveLabelTemplateAction(input: unknown): Promise<LabelActionState> {
  if (!LABEL_TEMPLATE_SCHEMA.safeParse(input).success) {
    return { error: messages.labels.templateForm.invalid };
  }
  const { user } = await requireUserCapability("stock.adjust");
  const result = await toActionResult(() => saveLabelTemplate(user, input), messages.errors);
  return result.ok
    ? { success: messages.labels.templateForm.saved }
    : { error: result.error.message };
}
