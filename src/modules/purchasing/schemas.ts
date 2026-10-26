import { z } from "zod";

import { MAX_CENTS } from "@/config/constants";
import { messages } from "@/config/messages.es";
import { parseLocalDateKey } from "@/lib/dates";

const v = messages.purchasing.validation;

const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;
const optionalText = (max: number) =>
  z.preprocess(blankToUndefined, z.string().trim().max(max).optional());
const optionalId = z.preprocess(blankToUndefined, z.string().trim().min(1).max(40).optional());
const id = z.string().trim().min(1).max(40);

const quantity = z
  .number({ error: v.quantity })
  .int(v.quantity)
  .min(1, v.quantity)
  .max(100_000, v.quantity);
const cents = z.number({ error: v.cost }).int(v.cost).min(0, v.cost).max(MAX_CENTS, v.cost);

const noDuplicates = {
  check: (value: { items: { variantId: string }[] }) =>
    new Set(value.items.map((item) => item.variantId)).size === value.items.length,
  message: v.duplicate,
};

export const purchaseOrderSchema = z
  .object({
    supplierId: z.string({ error: v.supplier }).trim().min(1, v.supplier),
    expectedAt: z.preprocess(
      blankToUndefined,
      z
        .string({ error: v.date })
        .refine((value) => parseLocalDateKey(value) !== null, v.date)
        .optional(),
    ),
    notes: optionalText(500),
    items: z
      .array(z.object({ variantId: id, orderedQty: quantity, unitCostCents: cents }))
      .min(1, v.items)
      .max(200),
  })
  .refine(noDuplicates.check, { message: noDuplicates.message, path: ["items"] });

export const receiptSchema = z
  .object({
    purchaseOrderId: optionalId,
    supplierId: optionalId,
    supplierInvoiceRef: optionalText(60),
    items: z
      .array(z.object({ variantId: id, quantity, unitCostCents: cents.optional() }))
      .min(1, v.items)
      .max(300),
  })
  .refine(noDuplicates.check, { message: noDuplicates.message, path: ["items"] })
  .refine((value) => value.purchaseOrderId !== undefined || value.supplierId !== undefined, {
    message: v.supplier,
    path: ["supplierId"],
  });

export type PurchaseOrderInput = z.output<typeof purchaseOrderSchema>;
export type ReceiptInput = z.output<typeof receiptSchema>;

export type PurchasingActionState = { error?: string; success?: string; id?: string } | undefined;
