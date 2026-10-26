"use server";

import { redirect } from "next/navigation";

import { messages } from "@/config/messages.es";
import { toActionResult } from "@/lib/action-result";
import { requireUserCapability } from "@/lib/auth";
import { text } from "@/lib/form-data";
import type { FormState } from "@/modules/auth/schemas";
import { CATALOG_CONFIG, isCatalogEntity } from "@/modules/catalog/config";
import { catalogSchemas } from "@/modules/catalog/schemas";
import { createItem, setItemArchived, updateItem } from "@/modules/catalog/service";

export async function saveItemAction(
  entity: string,
  id: string | null,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!isCatalogEntity(entity)) {
    return { error: messages.errors.NOT_FOUND };
  }
  const config = CATALOG_CONFIG[entity];
  const input = Object.fromEntries(
    config.fields.map((field) => [
      field.name,
      field.type === "checkbox"
        ? formData.get(field.name)
          ? "true"
          : ""
        : text(formData, field.name),
    ]),
  );

  const parsed = catalogSchemas[entity].safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? messages.errors.VALIDATION };
  }

  const { user } = await requireUserCapability(config.capability);
  const result = await toActionResult(
    () => (id ? updateItem(user, entity, id, input) : createItem(user, entity, input)),
    messages.errors,
  );
  if (!result.ok) {
    return { error: result.error.message };
  }
  if (!id) {
    redirect(`/catalogos/${entity}`);
  }
  return { success: messages.catalog.messages.saved };
}

export async function setItemArchivedAction(
  entity: string,
  id: string,
  archived: boolean,
): Promise<FormState> {
  if (!isCatalogEntity(entity)) {
    return { error: messages.errors.NOT_FOUND };
  }
  const { user } = await requireUserCapability(CATALOG_CONFIG[entity].capability);
  const result = await toActionResult(
    () => setItemArchived(user, entity, id, archived),
    messages.errors,
  );
  if (!result.ok) {
    return { error: result.error.message };
  }
  return {
    success: archived ? messages.catalog.messages.archived : messages.catalog.messages.restored,
  };
}
