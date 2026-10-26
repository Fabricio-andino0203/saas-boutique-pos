import { z } from "zod";

import { messages } from "@/config/messages.es";
import { parseLocalDateKey } from "@/lib/dates";
import type { CatalogEntity } from "@/modules/catalog/config";

const v = messages.catalog.validation;

const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const requiredName = z.string().trim().min(1, v.name).max(120);
const optionalText = (max = 200) =>
  z.preprocess(blankToUndefined, z.string().trim().max(max).optional());
const sortOrder = z.preprocess(
  (value) => (blankToUndefined(value) === undefined ? 0 : value),
  z.coerce.number({ error: v.number }).int(v.number).min(0, v.number).max(100000, v.number),
);
const dateKey = z.preprocess(
  blankToUndefined,
  z
    .string()
    .refine((value) => parseLocalDateKey(value) !== null, v.date)
    .optional(),
);
const hex = z.preprocess(
  blankToUndefined,
  z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, v.hex)
    .transform((value) => value.toUpperCase())
    .optional(),
);
const checkbox = z.preprocess((value) => value === "true" || value === "on", z.boolean());

export const catalogSchemas = {
  categories: z.object({
    name: requiredName,
    parentId: optionalText(40),
    sortOrder,
    allowsReturns: checkbox,
  }),
  brands: z.object({ name: requiredName }),
  seasons: z
    .object({ name: requiredName, startsAt: dateKey, endsAt: dateKey })
    .refine((value) => !value.startsAt || !value.endsAt || value.startsAt <= value.endsAt, {
      message: v.date,
      path: ["endsAt"],
    }),
  sizes: z.object({ name: requiredName, group: optionalText(40), sortOrder }),
  colors: z.object({ name: requiredName, hex, sortOrder }),
  suppliers: z.object({
    name: requiredName,
    taxId: optionalText(40),
    contactName: optionalText(120),
    phone: optionalText(40),
    email: z.preprocess(blankToUndefined, z.string().trim().email(v.email).max(120).optional()),
    address: optionalText(200),
    paymentTerms: optionalText(120),
    notes: optionalText(500),
  }),
} satisfies Record<CatalogEntity, z.ZodType>;

export type CatalogInput<E extends CatalogEntity> = z.output<(typeof catalogSchemas)[E]>;
