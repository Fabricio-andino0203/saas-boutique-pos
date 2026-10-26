import { describe, expect, it } from "vitest";

import { messages } from "@/config/messages.es";
import { localDateKey } from "@/lib/dates";
import { SETTING_DEFS, SETTING_KEYS } from "@/lib/settings";
import { SAMPLE_PRODUCTS } from "@/modules/settings/sample-products";
import { businessSchema, fiscalRangeSchema, settingsPatchSchema } from "@/modules/settings/schemas";

const v = messages.settings.validation;

describe("setting definitions", () => {
  it("every default is valid for its own schema", () => {
    for (const key of SETTING_KEYS) {
      const def = SETTING_DEFS[key];
      expect(def.schema.safeParse(def.default).success, key).toBe(true);
    }
  });

  it("starts with the documented defaults", () => {
    expect(SETTING_DEFS["tax.rate"].default).toBe(1500);
    expect(SETTING_DEFS["tax.pricesIncludeTax"].default).toBe(true);
    expect(SETTING_DEFS["sales.allowNegativeStock"].default).toBe(false);
    expect(SETTING_DEFS["discount.maxPercent.CASHIER"].default).toBe(10);
    expect(SETTING_DEFS["returns.maxDays"].default).toBe(8);
    expect(SETTING_DEFS["layaway.expiryDays"].default).toBe(30);
    expect(SETTING_DEFS["barcode.internalPrefix"].default).toBe("200");
    expect(SETTING_DEFS["onboarding.completed"].default).toBe(false);
  });
});

describe("settingsPatchSchema", () => {
  it("accepts any subset and rejects unknown keys", () => {
    expect(settingsPatchSchema.safeParse({}).success).toBe(true);
    expect(settingsPatchSchema.safeParse({ "tax.rate": 1500, "returns.maxDays": 15 }).success).toBe(
      true,
    );
    expect(settingsPatchSchema.safeParse({ "tax.rates": 1500 }).success).toBe(false);
  });

  it("checks the range of each value", () => {
    const bad: Record<string, unknown>[] = [
      { "tax.rate": -1 },
      { "tax.rate": 5001 },
      { "tax.rate": 15.5 },
      { "discount.maxPercent.CASHIER": 101 },
      { "returns.maxDays": 366 },
      { "layaway.expiryDays": 0 },
      { "barcode.internalPrefix": "20a" },
      { "barcode.internalPrefix": "" },
      { "barcode.internalPrefix": "1234567" },
      { "payments.enabled": [] },
      { "payments.enabled": ["STORE_CREDIT"] },
      { "ticket.footer": "x".repeat(201) },
      { "sales.allowNegativeStock": "yes" },
    ];
    for (const patch of bad) {
      expect(settingsPatchSchema.safeParse(patch).success, JSON.stringify(patch)).toBe(false);
    }
    expect(
      settingsPatchSchema.safeParse({
        "tax.rate": 0,
        "discount.maxPercent.CASHIER": 100,
        "barcode.internalPrefix": "123456",
        "payments.enabled": ["CASH"],
      }).success,
    ).toBe(true);
  });
});

describe("businessSchema", () => {
  it("requires the business name and treats blanks as missing", () => {
    const empty = businessSchema.safeParse({ legalName: "  " });
    expect(empty.success).toBe(false);
    expect(empty.error?.issues[0]?.message).toBe(v.legalName);

    const parsed = businessSchema.parse({ legalName: " Mi Boutique ", tradeName: "", phone: " " });
    expect(parsed.legalName).toBe("Mi Boutique");
    expect(parsed.tradeName).toBeUndefined();
    expect(parsed.phone).toBeUndefined();
  });
});

describe("fiscalRangeSchema", () => {
  const future = "2099-12-31";
  const valid = {
    documentType: "INVOICE",
    cai: "a1b2c3-d4e5f6-a7b8c9-d0e1f2-a3b4c5-d6",
    prefix: "000-001-01-",
    rangeStart: 1,
    rangeEnd: 500,
    expiresAt: future,
  };
  const messageOf = (input: object) => {
    const result = fiscalRangeSchema.safeParse(input);
    return result.success ? null : result.error.issues[0]?.message;
  };

  it("accepts a valid range and normalizes the CAI", () => {
    const parsed = fiscalRangeSchema.parse(valid);
    expect(parsed.cai).toBe("A1B2C3-D4E5F6-A7B8C9-D0E1F2-A3B4C5-D6");
    expect(parsed.terminalId).toBeUndefined();
  });

  it("validates the CAI format", () => {
    for (const cai of [
      "",
      "A1B2C3",
      "A1B2C3-D4E5F6-A7B8C9-D0E1F2-A3B4C5-D",
      "ñ1B2C3-D4E5F6-A7B8C9-D0E1F2-A3B4C5-D6",
    ]) {
      expect(messageOf({ ...valid, cai }), cai).toBe(v.cai);
    }
  });

  it("validates numbers, their order and the prefix", () => {
    expect(messageOf({ ...valid, rangeStart: 0 })).toBe(v.numbers);
    expect(messageOf({ ...valid, rangeEnd: 1.5 })).toBe(v.numbers);
    expect(messageOf({ ...valid, rangeStart: 10, rangeEnd: 9 })).toBe(v.order);
    expect(messageOf({ ...valid, rangeStart: 5, rangeEnd: 5 })).toBeNull();
    expect(messageOf({ ...valid, prefix: "000 001" })).toBe(v.fiscalPrefix);
    expect(messageOf({ ...valid, prefix: "" })).toBeNull();
  });

  it("does not accept a deadline in the past, but accepts today", () => {
    const today = localDateKey(new Date());
    const yesterday = localDateKey(new Date(Date.now() - 36 * 60 * 60 * 1000));
    expect(messageOf({ ...valid, expiresAt: today })).toBeNull();
    expect(messageOf({ ...valid, expiresAt: yesterday })).toBe(v.expired);
    expect(messageOf({ ...valid, expiresAt: "2026-02-30" })).toBe(v.date);
    expect(messageOf({ ...valid, expiresAt: "mañana" })).toBe(v.date);
  });

  it("only knows invoices and credit notes", () => {
    expect(messageOf({ ...valid, documentType: "TICKET" })).not.toBeNull();
    expect(messageOf({ ...valid, documentType: "CREDIT_NOTE" })).toBeNull();
  });
});

describe("sample products", () => {
  it("have unique DEMO codes, sensible prices and at least one variant", () => {
    const codes = SAMPLE_PRODUCTS.map((sample) => sample.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const sample of SAMPLE_PRODUCTS) {
      expect(sample.code, sample.name).toMatch(/^DEMO-\d{2}$/);
      expect(sample.priceCents, sample.name).toBeGreaterThan(sample.costCents);
      expect(sample.quantity, sample.name).toBeGreaterThan(0);
      expect(sample.sizes.length + sample.colors.length, sample.name).toBeGreaterThan(0);
    }
  });
});
