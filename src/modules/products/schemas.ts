import { z } from "zod";

import { MAX_CENTS, PRODUCT_LIMITS } from "@/config/constants";
import { messages } from "@/config/messages.es";

const v = messages.products.validation;

const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalText = (max: number) =>
  z.preprocess(blankToUndefined, z.string().trim().max(max).optional());
const optionalId = z.preprocess(blankToUndefined, z.string().trim().min(1).max(40).optional());
const id = z.string().trim().min(1).max(40);

const cents = (message: string) =>
  z.number({ error: message }).int(message).min(0, message).max(MAX_CENTS, message);

const optionalCode = z.preprocess(
  blankToUndefined,
  z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{2,20}$/, v.code)
    .transform((value) => value.toUpperCase())
    .optional(),
);

const quantities = z
  .record(
    z.string(),
    z.number({ error: v.quantity }).int(v.quantity).min(0, v.quantity).max(100000),
  )
  .default({});

export const productFieldsSchema = z.object({
  name: z.string().trim().min(1, v.name).max(160),
  description: optionalText(1000),
  categoryId: z.string({ error: v.category }).trim().min(1, v.category),
  brandId: optionalId,
  seasonId: optionalId,
  supplierId: optionalId,
  basePriceCents: cents(v.price).min(1, v.price),
  baseCostCents: cents(v.cost).default(0),
  taxCategory: z.enum(["STANDARD", "EXEMPT"]).default("STANDARD"),
});

const matrixFields = {
  sizeIds: z.array(id).max(80).default([]),
  colorIds: z.array(id).max(80).default([]),
  quantities,
};

function combinations(value: { sizeIds: string[]; colorIds: string[] }): number {
  return Math.max(1, value.sizeIds.length) * Math.max(1, value.colorIds.length);
}

const withinBatchLimit = {
  check: (value: { sizeIds: string[]; colorIds: string[] }) =>
    combinations(value) <= PRODUCT_LIMITS.maxVariantsPerBatch,
  message: v.tooMany,
};

export const createProductSchema = productFieldsSchema
  .extend({ code: optionalCode, ...matrixFields })
  .refine(withinBatchLimit.check, { message: withinBatchLimit.message, path: ["sizeIds"] });

export const addVariantsSchema = z
  .object(matrixFields)
  .refine((value) => value.sizeIds.length + value.colorIds.length > 0, {
    message: v.pickAny,
    path: ["sizeIds"],
  })
  .refine(withinBatchLimit.check, { message: withinBatchLimit.message, path: ["sizeIds"] });

export const variantUpdateSchema = z.object({
  priceCents: cents(v.price).min(1, v.price).nullable(),
  costCents: cents(v.cost).nullable(),
  reorderPoint: z
    .number({ error: v.reorder })
    .int(v.reorder)
    .min(0, v.reorder)
    .max(100000)
    .nullable(),
});

export const bulkEditSchema = z
  .object({
    productIds: z.array(id).min(1, v.bulkNone).max(PRODUCT_LIMITS.maxBulkProducts),
    categoryId: optionalId,
    seasonId: optionalId,
    price: z
      .discriminatedUnion("mode", [
        z.object({ mode: z.literal("none") }),
        z.object({ mode: z.literal("set"), cents: cents(v.price).min(1, v.price) }),
        z.object({
          mode: z.literal("percent"),
          bps: z
            .number({ error: v.percent })
            .int(v.percent)
            .min(-9000, v.percent)
            .max(100000, v.percent),
        }),
      ])
      .default({ mode: "none" }),
  })
  .refine((value) => value.categoryId || value.seasonId || value.price.mode !== "none", {
    message: v.bulkNothing,
    path: ["categoryId"],
  });

export const quickOptionSchema = z.object({
  entity: z.enum(["sizes", "colors"]),
  name: z.string().trim().min(1, messages.catalog.validation.name).max(120),
});

export type ProductFieldsInput = z.output<typeof productFieldsSchema>;
export type CreateProductInput = z.output<typeof createProductSchema>;
export type AddVariantsInput = z.output<typeof addVariantsSchema>;
export type VariantUpdateInput = z.output<typeof variantUpdateSchema>;
export type BulkEditInput = z.output<typeof bulkEditSchema>;

/** Resultado de las acciones del módulo (el cliente solo necesita el mensaje o el id nuevo). */
export type ProductActionState = { error?: string; success?: string; id?: string } | undefined;
