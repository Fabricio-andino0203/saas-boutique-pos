"use server";

import { messages } from "@/config/messages.es";
import { toActionResult } from "@/lib/action-result";
import { requireUserCapability } from "@/lib/auth";
import { LABEL_TEMPLATE_SCHEMA } from "@/lib/settings";
import { saveLabelTemplate } from "@/modules/labels/service";
import {
  listVariantsPage,
  searchPurchasableVariants,
  type VariantOption,
  type VariantPage,
} from "@/modules/purchasing/queries";

export type LabelActionState = { error?: string; success?: string } | undefined;

/**
 * La búsqueda de prendas de la pantalla de etiquetas. Es **suya**, con el permiso de esta pantalla (el mismo de la página):
 * antes reutilizaba la de compras, que exige el módulo «Compras», y en un plan sin él la búsqueda fallaba.
 */
export async function searchLabelVariantsAction(query: string): Promise<VariantOption[]> {
  await requireUserCapability("stock.adjust");
  return searchPurchasableVariants(String(query), { includeCost: false });
}

/** Todas las prendas, de a páginas, para elegir mirando la lista. */
export async function browseLabelVariantsAction(offset: number): Promise<VariantPage> {
  await requireUserCapability("stock.adjust");
  return listVariantsPage(Number(offset), { includeCost: false });
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
