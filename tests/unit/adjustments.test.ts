import { describe, expect, it } from "vitest";

import { messages } from "@/config/messages.es";
import { adjustmentSchema, ADJUSTMENT_REASONS, reasonText } from "@/modules/inventory/reasons";

const v = messages.inventory.adjust.validation;

const valid = { variantId: "v1", mode: "in", quantity: 3, reason: "WASTE" };
const messageOf = (input: object) => {
  const result = adjustmentSchema.safeParse(input);
  return result.success ? null : result.error.issues[0]?.message;
};

describe("adjustmentSchema", () => {
  it("accepts an entry, an exit and a set-to value", () => {
    expect(adjustmentSchema.safeParse(valid).success).toBe(true);
    expect(adjustmentSchema.safeParse({ ...valid, mode: "out" }).success).toBe(true);
    expect(adjustmentSchema.safeParse({ ...valid, mode: "set", quantity: 0 }).success).toBe(true);
  });

  it("needs at least one unit for entries and exits, but allows setting zero", () => {
    expect(messageOf({ ...valid, quantity: 0 })).toBe(v.quantity);
    expect(messageOf({ ...valid, mode: "out", quantity: 0 })).toBe(v.quantity);
    expect(messageOf({ ...valid, mode: "set", quantity: 0 })).toBeNull();
  });

  it("rejects fractions, negatives, NaN and absurd amounts", () => {
    for (const quantity of [1.5, -1, Number.NaN, 1_000_001]) {
      expect(messageOf({ ...valid, quantity }), String(quantity)).toBe(v.quantity);
    }
  });

  it("requires a known reason", () => {
    expect(messageOf({ ...valid, reason: "" })).toBe(v.reason);
    expect(messageOf({ ...valid, reason: "POR_GUSTO" })).toBe(v.reason);
    expect(messageOf({ variantId: "v1", mode: "in", quantity: 1 })).toBe(v.reason);
  });

  it("requires a detail when the reason is Other", () => {
    expect(messageOf({ ...valid, reason: "OTHER" })).toBe(v.note);
    expect(messageOf({ ...valid, reason: "OTHER", note: "   " })).toBe(v.note);
    expect(messageOf({ ...valid, reason: "OTHER", note: "Se cayó del exhibidor" })).toBeNull();
    expect(messageOf({ ...valid, reason: "WASTE", note: "" })).toBeNull();
  });

  it("limits the detail to 200 characters", () => {
    expect(messageOf({ ...valid, note: "x".repeat(201) })).not.toBeNull();
    expect(messageOf({ ...valid, note: "x".repeat(200) })).toBeNull();
  });
});

describe("reasonText", () => {
  it("writes the label alone, or with the detail", () => {
    expect(reasonText("WASTE")).toBe("Merma");
    expect(reasonText("OTHER", "Se cayó")).toBe("Otro: Se cayó");
  });

  it("has a Spanish label for every reason", () => {
    for (const reason of ADJUSTMENT_REASONS) {
      expect(reasonText(reason).length, reason).toBeGreaterThan(2);
    }
  });
});
