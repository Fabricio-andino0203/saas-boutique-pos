"use server";

import { messages } from "@/config/messages.es";
import { toActionResult } from "@/lib/action-result";
import { requireUserCapability } from "@/lib/auth";
import { LABEL_TEMPLATE_SCHEMA } from "@/lib/settings";
import { saveLabelTemplate } from "@/modules/labels/service";

export type LabelActionState = { error?: string; success?: string } | undefined;

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
