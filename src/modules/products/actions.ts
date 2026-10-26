"use server";

import { redirect } from "next/navigation";

import { messages } from "@/config/messages.es";
import { toActionResult } from "@/lib/action-result";
import { requireUserCapability } from "@/lib/auth";
import type { ProductActionState } from "@/modules/products/schemas";
import {
  addVariants,
  bulkEditProducts,
  createProduct,
  duplicateProduct,
  quickCreateOption,
  setProductArchived,
  setVariantArchived,
  updateProduct,
  updateVariant,
} from "@/modules/products/service";

const copy = messages.products;

export async function createProductAction(input: unknown): Promise<ProductActionState> {
  const { user } = await requireUserCapability("product.write");
  const result = await toActionResult(() => createProduct(user, input), messages.errors);
  return result.ok ? { id: result.data.id } : { error: result.error.message };
}

export async function updateProductAction(id: string, input: unknown): Promise<ProductActionState> {
  const { user } = await requireUserCapability("product.write");
  const result = await toActionResult(() => updateProduct(user, id, input), messages.errors);
  return result.ok ? { success: copy.detail.saved } : { error: result.error.message };
}

export async function updateVariantAction(
  variantId: string,
  input: unknown,
): Promise<ProductActionState> {
  const { user } = await requireUserCapability("product.write");
  const result = await toActionResult(() => updateVariant(user, variantId, input), messages.errors);
  return result.ok ? { success: copy.detail.variantSaved } : { error: result.error.message };
}

export async function addVariantsAction(
  productId: string,
  input: unknown,
): Promise<ProductActionState> {
  const { user } = await requireUserCapability("product.write");
  const result = await toActionResult(() => addVariants(user, productId, input), messages.errors);
  return result.ok ? { success: copy.detail.added } : { error: result.error.message };
}

export async function setProductArchivedAction(
  id: string,
  archived: boolean,
): Promise<ProductActionState> {
  const { user } = await requireUserCapability("product.write");
  const result = await toActionResult(
    () => setProductArchived(user, id, archived),
    messages.errors,
  );
  if (!result.ok) {
    return { error: result.error.message };
  }
  return { success: archived ? copy.detail.archived : copy.detail.restored };
}

export async function setVariantArchivedAction(
  variantId: string,
  archived: boolean,
): Promise<ProductActionState> {
  const { user } = await requireUserCapability("product.write");
  const result = await toActionResult(
    () => setVariantArchived(user, variantId, archived),
    messages.errors,
  );
  return result.ok ? { success: copy.detail.variantSaved } : { error: result.error.message };
}

export async function duplicateProductAction(id: string): Promise<ProductActionState> {
  const { user } = await requireUserCapability("product.write");
  const result = await toActionResult(() => duplicateProduct(user, id), messages.errors);
  if (!result.ok) {
    return { error: result.error.message };
  }
  redirect(`/productos/${result.data.id}`);
}

export async function bulkEditProductsAction(input: unknown): Promise<ProductActionState> {
  const { user } = await requireUserCapability("product.write");
  const result = await toActionResult(() => bulkEditProducts(user, input), messages.errors);
  return result.ok ? { success: copy.bulk.done } : { error: result.error.message };
}

export async function quickCreateOptionAction(
  input: unknown,
): Promise<{ option: { id: string; name: string; hex: string | null } } | { error: string }> {
  const { user } = await requireUserCapability("product.write");
  const result = await toActionResult(() => quickCreateOption(user, input), messages.errors);
  return result.ok ? { option: result.data } : { error: result.error.message };
}
