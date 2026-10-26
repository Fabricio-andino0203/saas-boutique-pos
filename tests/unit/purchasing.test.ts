import { describe, expect, it } from "vitest";

import { messages } from "@/config/messages.es";
import { purchaseOrderSchema, receiptSchema } from "@/modules/purchasing/schemas";

const v = messages.purchasing.validation;

const line = { variantId: "v1", orderedQty: 10, unitCostCents: 5000 };
const messageOf = (schema: typeof purchaseOrderSchema | typeof receiptSchema, input: object) => {
  const result = schema.safeParse(input);
  return result.success ? null : result.error.issues[0]?.message;
};

describe("purchaseOrderSchema", () => {
  const valid = { supplierId: "s1", items: [line] };

  it("accepts the minimum and optional fields", () => {
    expect(purchaseOrderSchema.safeParse(valid).success).toBe(true);
    const parsed = purchaseOrderSchema.parse({
      ...valid,
      expectedAt: "2026-12-01",
      notes: " Urgente ",
    });
    expect(parsed).toMatchObject({ expectedAt: "2026-12-01", notes: "Urgente" });
    expect(
      purchaseOrderSchema.parse({ ...valid, expectedAt: "", notes: "" }).expectedAt,
    ).toBeUndefined();
  });

  it("requires a supplier and at least one line", () => {
    expect(messageOf(purchaseOrderSchema, { items: [line] })).toBe(v.supplier);
    expect(messageOf(purchaseOrderSchema, { ...valid, supplierId: " " })).toBe(v.supplier);
    expect(messageOf(purchaseOrderSchema, { ...valid, items: [] })).toBe(v.items);
  });

  it("validates quantities and costs", () => {
    for (const orderedQty of [0, -1, 1.5, 100_001]) {
      expect(
        messageOf(purchaseOrderSchema, { ...valid, items: [{ ...line, orderedQty }] }),
        String(orderedQty),
      ).toBe(v.quantity);
    }
    for (const unitCostCents of [-1, 10.5, 2_000_000_001]) {
      expect(
        messageOf(purchaseOrderSchema, { ...valid, items: [{ ...line, unitCostCents }] }),
        String(unitCostCents),
      ).toBe(v.cost);
    }
    expect(
      purchaseOrderSchema.safeParse({ ...valid, items: [{ ...line, unitCostCents: 0 }] }).success,
    ).toBe(true);
  });

  it("rejects repeated variants and invalid dates", () => {
    expect(
      messageOf(purchaseOrderSchema, { ...valid, items: [line, { ...line, orderedQty: 2 }] }),
    ).toBe(v.duplicate);
    expect(messageOf(purchaseOrderSchema, { ...valid, expectedAt: "2026-02-30" })).toBe(v.date);
  });

  it("limits an order to 200 lines", () => {
    const many = Array.from({ length: 201 }, (_, i) => ({ ...line, variantId: `v${i}` }));
    expect(purchaseOrderSchema.safeParse({ ...valid, items: many }).success).toBe(false);
    expect(purchaseOrderSchema.safeParse({ ...valid, items: many.slice(0, 200) }).success).toBe(
      true,
    );
  });
});

describe("receiptSchema", () => {
  const item = { variantId: "v1", quantity: 4 };

  it("needs a supplier or an order", () => {
    expect(messageOf(receiptSchema, { items: [item] })).toBe(v.supplier);
    expect(receiptSchema.safeParse({ supplierId: "s1", items: [item] }).success).toBe(true);
    expect(receiptSchema.safeParse({ purchaseOrderId: "o1", items: [item] }).success).toBe(true);
    expect(
      receiptSchema.safeParse({ purchaseOrderId: "", supplierId: "", items: [item] }).success,
    ).toBe(false);
  });

  it("makes the cost optional but validates it when present", () => {
    expect(
      receiptSchema.safeParse({ supplierId: "s1", items: [{ ...item, unitCostCents: 0 }] }).success,
    ).toBe(true);
    expect(
      messageOf(receiptSchema, { supplierId: "s1", items: [{ ...item, unitCostCents: -5 }] }),
    ).toBe(v.cost);
  });

  it("validates quantities, duplicates and the invoice reference", () => {
    expect(messageOf(receiptSchema, { supplierId: "s1", items: [{ ...item, quantity: 0 }] })).toBe(
      v.quantity,
    );
    expect(messageOf(receiptSchema, { supplierId: "s1", items: [item, item] })).toBe(v.duplicate);
    expect(messageOf(receiptSchema, { supplierId: "s1", items: [] })).toBe(v.items);
    expect(
      receiptSchema.safeParse({
        supplierId: "s1",
        supplierInvoiceRef: "x".repeat(61),
        items: [item],
      }).success,
    ).toBe(false);
    expect(
      receiptSchema.parse({ supplierId: "s1", supplierInvoiceRef: " F-001 ", items: [item] })
        .supplierInvoiceRef,
    ).toBe("F-001");
  });
});
