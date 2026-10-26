import { describe, expect, it } from "vitest";

import { messages } from "@/config/messages.es";
import { buildEan13, ean13CheckDigit, isValidEan13 } from "@/lib/barcode";
import { ValidationError } from "@/lib/errors";
import {
  addVariantsSchema,
  bulkEditSchema,
  createProductSchema,
  variantUpdateSchema,
} from "@/modules/products/schemas";
import { buildSkuBase, cellKey, skuPart, uniqueSku } from "@/modules/products/sku";

const v = messages.products.validation;

describe("EAN-13", () => {
  it("computes the check digit by hand-derived examples", () => {
    expect(ean13CheckDigit("400638133393")).toBe(1); // 4006381333931 es un EAN-13 real
    expect(ean13CheckDigit("200000000001")).toBe(5); // 2 + 1×3 = 5 → 10 − 5
    expect(ean13CheckDigit("200123456789")).toBe(3); // suma 97 → 10 − 7
    expect(ean13CheckDigit("000000000000")).toBe(0);
  });

  it("rejects bodies that are not 12 digits", () => {
    for (const body of ["", "12345678901", "1234567890123", "abcdefghijkl"]) {
      expect(() => ean13CheckDigit(body), body).toThrow(ValidationError);
    }
  });

  it("validates complete codes", () => {
    expect(isValidEan13("4006381333931")).toBe(true);
    expect(isValidEan13("4006381333932")).toBe(false);
    expect(isValidEan13("400638133393")).toBe(false);
    expect(isValidEan13("abcdefghijklm")).toBe(false);
  });

  it("builds internal codes: prefix + padded serial + check digit", () => {
    expect(buildEan13("200", 1)).toBe("2000000000015");
    expect(buildEan13("200", 123456789)).toBe("2001234567893");
    expect(isValidEan13(buildEan13("200", 42))).toBe(true);
    expect(buildEan13("20", 1)).toHaveLength(13);
  });

  it("rejects a bad prefix or a serial out of range", () => {
    expect(() => buildEan13("ab", 1)).toThrow(ValidationError);
    expect(() => buildEan13("", 1)).toThrow(ValidationError);
    expect(() => buildEan13("200", -1)).toThrow(ValidationError);
    expect(() => buildEan13("200", 1.5)).toThrow(ValidationError);
    expect(() => buildEan13("200", 1_000_000_000)).toThrow(ValidationError); // 10 dígitos > 9
  });
});

describe("SKU helpers", () => {
  it("keeps only unaccented uppercase letters and digits", () => {
    expect(skuPart("Azul marino")).toBe("AZULMARINO");
    expect(skuPart("Niños XL")).toBe("NINOSXL");
    expect(skuPart("  --  ")).toBe("");
  });

  it("joins code, size and color, skipping what is missing", () => {
    expect(buildSkuBase("P00001", "M", "Rojo")).toBe("P00001-M-ROJO");
    expect(buildSkuBase("P00001", null, "Rojo")).toBe("P00001-ROJO");
    expect(buildSkuBase("P00001", "M", undefined)).toBe("P00001-M");
    expect(buildSkuBase("P00001")).toBe("P00001");
    expect(buildSkuBase("P00001", "!!", "Rojo")).toBe("P00001-ROJO");
  });

  it("adds a numeric suffix on collisions and reserves what it returns", () => {
    const taken = new Set(["A-1"]);
    expect(uniqueSku("A-1", taken)).toBe("A-1-2");
    expect(uniqueSku("A-1", taken)).toBe("A-1-3");
    expect(uniqueSku("B-1", taken)).toBe("B-1");
    expect(taken.has("B-1")).toBe(true);
  });

  it("builds stable cell keys", () => {
    expect(cellKey("s1", "c1")).toBe("s1:c1");
    expect(cellKey(null, "c1")).toBe("-:c1");
    expect(cellKey("s1", null)).toBe("s1:-");
    expect(cellKey(null, null)).toBe("-:-");
  });
});

const validProduct = { name: "Vestido", categoryId: "cat1", basePriceCents: 25000 };

describe("createProductSchema", () => {
  it("accepts the minimum and fills defaults", () => {
    const parsed = createProductSchema.parse(validProduct);
    expect(parsed).toMatchObject({
      name: "Vestido",
      baseCostCents: 0,
      taxCategory: "STANDARD",
      sizeIds: [],
      colorIds: [],
      quantities: {},
    });
    expect(parsed.code).toBeUndefined();
    expect(parsed.brandId).toBeUndefined();
  });

  it("treats blank optional fields as missing and normalizes the code", () => {
    const parsed = createProductSchema.parse({
      ...validProduct,
      brandId: "",
      seasonId: " ",
      supplierId: "",
      description: "",
      code: "ves-01",
    });
    expect(parsed.brandId).toBeUndefined();
    expect(parsed.seasonId).toBeUndefined();
    expect(parsed.description).toBeUndefined();
    expect(parsed.code).toBe("VES-01");
  });

  it("requires a name, a category and a positive price", () => {
    const messageOf = (input: object) => {
      const result = createProductSchema.safeParse(input);
      return result.success ? null : result.error.issues[0]?.message;
    };
    expect(messageOf({ ...validProduct, name: "  " })).toBe(v.name);
    expect(messageOf({ ...validProduct, categoryId: "" })).toBe(v.category);
    expect(messageOf({ name: "X", basePriceCents: 100 })).toBe(v.category);
    expect(messageOf({ ...validProduct, basePriceCents: 0 })).toBe(v.price);
    expect(messageOf({ ...validProduct, basePriceCents: 10.5 })).toBe(v.price);
    expect(messageOf({ ...validProduct, basePriceCents: 2_000_000_001 })).toBe(v.price);
    expect(messageOf({ ...validProduct, baseCostCents: -1 })).toBe(v.cost);
  });

  it("rejects malformed codes", () => {
    for (const code of ["a", "x".repeat(21), "con espacio", "ñandú"]) {
      expect(createProductSchema.safeParse({ ...validProduct, code }).success, code).toBe(false);
    }
  });

  it("limits the matrix to 200 combinations", () => {
    const ids = (count: number, prefix: string) =>
      Array.from({ length: count }, (_, index) => `${prefix}${index}`);
    expect(
      createProductSchema.safeParse({
        ...validProduct,
        sizeIds: ids(20, "s"),
        colorIds: ids(10, "c"),
      }).success,
    ).toBe(true); // 200
    const tooMany = createProductSchema.safeParse({
      ...validProduct,
      sizeIds: ids(21, "s"),
      colorIds: ids(10, "c"),
    });
    expect(tooMany.success).toBe(false);
    expect(tooMany.error?.issues[0]?.message).toBe(v.tooMany);
  });

  it("accepts only whole, non-negative quantities", () => {
    expect(
      createProductSchema.safeParse({ ...validProduct, quantities: { "a:b": 3, "-:-": 0 } })
        .success,
    ).toBe(true);
    for (const bad of [-1, 1.5, "3"]) {
      expect(
        createProductSchema.safeParse({ ...validProduct, quantities: { "a:b": bad } }).success,
        String(bad),
      ).toBe(false);
    }
  });
});

describe("addVariantsSchema", () => {
  it("needs at least one size or color", () => {
    expect(addVariantsSchema.safeParse({}).success).toBe(false);
    expect(addVariantsSchema.safeParse({ sizeIds: ["s1"] }).success).toBe(true);
    expect(addVariantsSchema.safeParse({ colorIds: ["c1"] }).success).toBe(true);
  });
});

describe("variantUpdateSchema", () => {
  it("allows clearing overrides with null", () => {
    expect(
      variantUpdateSchema.parse({ priceCents: null, costCents: null, reorderPoint: null }),
    ).toEqual({ priceCents: null, costCents: null, reorderPoint: null });
  });

  it("validates price, cost and reorder point", () => {
    const ok = { priceCents: 1000, costCents: 0, reorderPoint: 0 };
    expect(variantUpdateSchema.safeParse(ok).success).toBe(true);
    expect(variantUpdateSchema.safeParse({ ...ok, priceCents: 0 }).success).toBe(false);
    expect(variantUpdateSchema.safeParse({ ...ok, costCents: -5 }).success).toBe(false);
    expect(variantUpdateSchema.safeParse({ ...ok, reorderPoint: 1.5 }).success).toBe(false);
    expect(variantUpdateSchema.safeParse({ priceCents: 1000 }).success).toBe(false);
  });
});

describe("bulkEditSchema", () => {
  const base = { productIds: ["p1", "p2"] };

  it("requires at least one change", () => {
    const result = bulkEditSchema.safeParse(base);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(v.bulkNothing);
    expect(bulkEditSchema.safeParse({ ...base, categoryId: "c1" }).success).toBe(true);
    expect(bulkEditSchema.safeParse({ ...base, seasonId: "s1" }).success).toBe(true);
  });

  it("requires at least one product", () => {
    expect(bulkEditSchema.safeParse({ productIds: [], categoryId: "c1" }).success).toBe(false);
  });

  it("validates the price change", () => {
    const withPrice = (price: object) => bulkEditSchema.safeParse({ ...base, price }).success;
    expect(withPrice({ mode: "set", cents: 12000 })).toBe(true);
    expect(withPrice({ mode: "set", cents: 0 })).toBe(false);
    expect(withPrice({ mode: "percent", bps: -1500 })).toBe(true);
    expect(withPrice({ mode: "percent", bps: -9001 })).toBe(false);
    expect(withPrice({ mode: "percent", bps: 100001 })).toBe(false);
    expect(withPrice({ mode: "percent", bps: 1.5 })).toBe(false);
    expect(withPrice({ mode: "none" })).toBe(false); // sin nada más que cambiar
  });
});
