import { z } from "zod";

import { messages } from "@/config/messages.es";
import { localDateKey, parseLocalDateKey } from "@/lib/dates";
import { SETTING_DEFS } from "@/lib/settings";

const v = messages.settings.validation;

const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;
const optionalText = (max: number) =>
  z.preprocess(blankToUndefined, z.string().trim().max(max).optional());

export const businessSchema = z.object({
  legalName: z.string().trim().min(1, v.legalName).max(160),
  tradeName: optionalText(160),
  taxId: optionalText(40),
  address: optionalText(240),
  phone: optionalText(40),
});

/** Cualquier subconjunto de ajustes conocidos; una clave desconocida se rechaza. */
export const settingsPatchSchema = z
  .object({
    "tax.rate": SETTING_DEFS["tax.rate"].schema,
    "tax.pricesIncludeTax": SETTING_DEFS["tax.pricesIncludeTax"].schema,
    "sales.allowNegativeStock": SETTING_DEFS["sales.allowNegativeStock"].schema,
    "discount.maxPercent.CASHIER": SETTING_DEFS["discount.maxPercent.CASHIER"].schema,
    "returns.maxDays": SETTING_DEFS["returns.maxDays"].schema,
    "layaway.expiryDays": SETTING_DEFS["layaway.expiryDays"].schema,
    "layaway.minDepositPercent": SETTING_DEFS["layaway.minDepositPercent"].schema,
    "ticket.footer": SETTING_DEFS["ticket.footer"].schema,
    "payments.enabled": SETTING_DEFS["payments.enabled"].schema,
    "barcode.internalPrefix": SETTING_DEFS["barcode.internalPrefix"].schema,
    "onboarding.completed": SETTING_DEFS["onboarding.completed"].schema,
  })
  .partial()
  .strict();

const wholeNumber = z
  .number({ error: v.numbers })
  .int(v.numbers)
  .min(1, v.numbers)
  .max(99_999_999, v.numbers);
const dateKey = z
  .string({ error: v.date })
  .refine((value) => parseLocalDateKey(value) !== null, v.date);

export const fiscalRangeSchema = z
  .object({
    documentType: z.enum(["INVOICE", "CREDIT_NOTE"]),
    terminalId: z.preprocess(blankToUndefined, z.string().trim().min(1).max(40).optional()),
    cai: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{6}(-[A-Z0-9]{6}){4}-[A-Z0-9]{2}$/, v.cai),
    prefix: z
      .string()
      .trim()
      .max(20)
      .regex(/^[0-9A-Za-z-]*$/, v.fiscalPrefix),
    rangeStart: wholeNumber,
    rangeEnd: wholeNumber,
    expiresAt: dateKey,
  })
  .refine((value) => value.rangeStart <= value.rangeEnd, { message: v.order, path: ["rangeEnd"] })
  .refine((value) => value.expiresAt >= localDateKey(new Date()), {
    message: v.expired,
    path: ["expiresAt"],
  });

export type BusinessInput = z.output<typeof businessSchema>;
export type FiscalRangeInput = z.output<typeof fiscalRangeSchema>;
export type SettingsPatchInput = z.output<typeof settingsPatchSchema>;

export type SettingsActionState = { error?: string; success?: string } | undefined;
