"use server";

import { messages } from "@/config/messages.es";
import { toActionResult } from "@/lib/action-result";
import { requireUserCapability } from "@/lib/auth";
import { text } from "@/lib/form-data";
import { parsePercentBps } from "@/lib/format";
import { PAYMENT_METHODS } from "@/lib/settings";
import {
  businessSchema,
  fiscalRangeSchema,
  settingsPatchSchema,
  type SettingsActionState,
} from "@/modules/settings/schemas";
import { loadSampleData } from "@/modules/settings/sample-data";
import {
  createFiscalRange,
  setFiscalRangeActive,
  updateBusinessProfile,
  updateSettings,
} from "@/modules/settings/service";

const copy = messages.settings;

export type SettingsGroup = "tax" | "payments" | "rules" | "codes";

export async function saveBusinessAction(
  _previous: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const input = Object.fromEntries(
    ["legalName", "tradeName", "taxId", "address", "phone"].map((key) => [
      key,
      text(formData, key),
    ]),
  );
  const parsed = businessSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? messages.errors.VALIDATION };
  }
  const { user } = await requireUserCapability("settings.manage");
  const result = await toActionResult(() => updateBusinessProfile(user, input), messages.errors);
  return result.ok ? { success: copy.saved } : { error: result.error.message };
}

const wholeNumber = (value: string): number =>
  /^\d{1,3}$/.test(value.trim()) ? Number(value) : NaN;

/** Arma el ajuste a partir de los campos de los grupos pedidos; lo que no está en el formulario no se toca. */
function buildPatch(groups: SettingsGroup[], formData: FormData): Record<string, unknown> | string {
  const patch: Record<string, unknown> = {};
  if (groups.includes("tax")) {
    const rate = parsePercentBps(text(formData, "taxRate"));
    if (rate === null || rate < 0) {
      return copy.validation.percent;
    }
    patch["tax.rate"] = rate;
    patch["tax.pricesIncludeTax"] = formData.get("pricesIncludeTax") !== null;
  }
  if (groups.includes("payments")) {
    const chosen = formData
      .getAll("payments")
      .filter((value): value is (typeof PAYMENT_METHODS)[number] =>
        (PAYMENT_METHODS as readonly unknown[]).includes(value),
      );
    if (chosen.length === 0) {
      return copy.validation.payments;
    }
    patch["payments.enabled"] = chosen;
  }
  if (groups.includes("rules")) {
    patch["discount.maxPercent.CASHIER"] = wholeNumber(text(formData, "discount"));
    patch["returns.maxDays"] = wholeNumber(text(formData, "returnsDays"));
    patch["layaway.expiryDays"] = wholeNumber(text(formData, "layawayDays"));
    patch["sales.allowNegativeStock"] = formData.get("allowNegativeStock") !== null;
  }
  if (groups.includes("codes")) {
    patch["barcode.internalPrefix"] = text(formData, "barcodePrefix").trim();
    patch["ticket.footer"] = text(formData, "ticketFooter").trim();
  }
  return patch;
}

function messageFor(path: PropertyKey | undefined): string {
  switch (path) {
    case "tax.rate":
      return copy.validation.percent;
    case "payments.enabled":
      return copy.validation.payments;
    case "barcode.internalPrefix":
      return copy.validation.prefix;
    default:
      return copy.validation.whole;
  }
}

export async function saveSettingsAction(
  groups: SettingsGroup[],
  _previous: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const patch = buildPatch(groups, formData);
  if (typeof patch === "string") {
    return { error: patch };
  }
  const parsed = settingsPatchSchema.safeParse(patch);
  if (!parsed.success) {
    return { error: messageFor(parsed.error.issues[0]?.path[0]) };
  }
  const { user } = await requireUserCapability("settings.manage");
  const result = await toActionResult(() => updateSettings(user, patch), messages.errors);
  return result.ok ? { success: copy.saved } : { error: result.error.message };
}

export async function finishOnboardingAction(): Promise<SettingsActionState> {
  const { user } = await requireUserCapability("settings.manage");
  const result = await toActionResult(
    () => updateSettings(user, { "onboarding.completed": true }),
    messages.errors,
  );
  return result.ok ? { success: copy.saved } : { error: result.error.message };
}

export async function loadSampleDataAction(): Promise<SettingsActionState> {
  const { user } = await requireUserCapability("settings.manage");
  const result = await toActionResult(() => loadSampleData(user), messages.errors);
  if (!result.ok) {
    return { error: result.error.message };
  }
  return {
    success:
      result.data.created > 0
        ? `${copy.sample.done} ${result.data.created} ${copy.sample.products}.`
        : copy.sample.already,
  };
}

export async function saveFiscalRangeAction(
  _previous: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const number = (key: string): number =>
    text(formData, key).trim() === "" ? NaN : Number(text(formData, key));
  const input = {
    documentType: text(formData, "documentType"),
    terminalId: text(formData, "terminalId"),
    cai: text(formData, "cai"),
    prefix: text(formData, "prefix"),
    rangeStart: number("rangeStart"),
    rangeEnd: number("rangeEnd"),
    expiresAt: text(formData, "expiresAt"),
  };
  const parsed = fiscalRangeSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? messages.errors.VALIDATION };
  }
  const { user } = await requireUserCapability("settings.manage");
  const result = await toActionResult(() => createFiscalRange(user, input), messages.errors);
  return result.ok ? { success: copy.fiscal.created } : { error: result.error.message };
}

export async function setFiscalRangeActiveAction(
  id: string,
  active: boolean,
): Promise<SettingsActionState> {
  const { user } = await requireUserCapability("settings.manage");
  const result = await toActionResult(
    () => setFiscalRangeActive(user, id, active),
    messages.errors,
  );
  if (!result.ok) {
    return { error: result.error.message };
  }
  return { success: active ? copy.fiscal.activated : copy.fiscal.deactivated };
}
