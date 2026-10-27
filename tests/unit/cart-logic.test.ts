import { describe, expect, it } from "vitest";

import {
  MAX_LINE_QUANTITY,
  addToCart,
  labelOfVariant,
  removeItem,
  setItemDiscount,
  setQuantity,
  summarizeCart,
  type CartItem,
  type NewCartItem,
} from "@/modules/sales/cart-logic";

const STRICT = { allowNegativeStock: false };
const LOOSE = { allowNegativeStock: true };

const dress = (extra: Partial<NewCartItem> = {}): NewCartItem => ({
  id: "line-1",
  variantId: "v-dress",
  productName: "Vestido",
  variantLabel: "M · Azul",
  sku: "VES1-M",
  unitPriceCents: 11500,
  maxStock: 3,
  taxExempt: false,
  ...extra,
});

const item = (extra: Partial<CartItem> = {}): CartItem => ({ ...dress(), quantity: 1, ...extra });

describe("labelOfVariant", () => {
  it("joins size and color, and is empty without either", () => {
    expect(labelOfVariant({ sizeName: "M", colorName: "Azul" })).toBe("M · Azul");
    expect(labelOfVariant({ sizeName: "M", colorName: null })).toBe("M");
    expect(labelOfVariant({ sizeName: null, colorName: null })).toBe("");
  });
});

describe("addToCart", () => {
  it("adds a new line with quantity one", () => {
    const change = addToCart([], dress(), STRICT);
    expect(change).toEqual({ items: [item()], capped: false, touchedId: "line-1" });
  });

  it("adds one more unit when the garment is already in the ticket", () => {
    const first = addToCart([], dress(), STRICT).items;
    const change = addToCart(first, dress({ id: "line-2" }), STRICT);
    expect(change.items).toHaveLength(1);
    expect(change.items[0]).toMatchObject({ id: "line-1", quantity: 2 });
    expect(change).toMatchObject({ capped: false, touchedId: "line-1" });
  });

  it("stops at what is in stock and says so", () => {
    let items: CartItem[] = [];
    for (let index = 0; index < 3; index += 1) {
      items = addToCart(items, dress(), STRICT).items;
    }
    expect(items[0]?.quantity).toBe(3);
    const change = addToCart(items, dress(), STRICT);
    expect(change.capped).toBe(true);
    expect(change.items[0]?.quantity).toBe(3);
  });

  it("does not add a garment that has none left", () => {
    const change = addToCart([], dress({ maxStock: 0 }), STRICT);
    expect(change).toEqual({ items: [], capped: true, touchedId: null });
    expect(addToCart([], dress({ maxStock: -2 }), STRICT).items).toEqual([]);
  });

  it("ignores the stock when negative stock is allowed", () => {
    const change = addToCart([], dress({ maxStock: 0 }), LOOSE);
    expect(change.items).toHaveLength(1);
    expect(change.capped).toBe(false);
  });

  it("never goes above the quantity the server accepts", () => {
    const change = addToCart([], dress({ quantity: 20000 }), LOOSE);
    expect(change.items[0]?.quantity).toBe(MAX_LINE_QUANTITY);
    expect(change.capped).toBe(true);
  });

  it("refreshes the stock it saw when the garment is added again", () => {
    const first = addToCart([], dress({ maxStock: 5 }), STRICT).items;
    const change = addToCart(first, dress({ maxStock: 2 }), STRICT);
    expect(change.items[0]).toMatchObject({ quantity: 2, maxStock: 2 });
    expect(change.capped).toBe(false);
  });
});

describe("setQuantity", () => {
  const items = [item({ quantity: 2 })];

  it("sets the quantity", () => {
    const change = setQuantity(items, "line-1", 3, STRICT);
    expect(change.items[0]?.quantity).toBe(3);
    expect(change.capped).toBe(false);
  });

  it("caps at the stock", () => {
    const change = setQuantity(items, "line-1", 10, STRICT);
    expect(change.items[0]?.quantity).toBe(3);
    expect(change.capped).toBe(true);
  });

  it("removes the line at zero or below", () => {
    expect(setQuantity(items, "line-1", 0, STRICT).items).toEqual([]);
    expect(setQuantity(items, "line-1", -1, STRICT).items).toEqual([]);
  });

  it("truncates decimals and ignores nonsense", () => {
    expect(setQuantity(items, "line-1", 2.9, STRICT).items[0]?.quantity).toBe(2);
    expect(setQuantity(items, "line-1", Number.NaN, STRICT).items).toEqual(items);
    expect(setQuantity(items, "otra", 2, STRICT).items).toEqual(items);
  });

  it("keeps at least one unit when the stock fell to zero", () => {
    const empty = [item({ quantity: 1, maxStock: 0 })];
    expect(setQuantity(empty, "line-1", 1, STRICT).items[0]?.quantity).toBe(1);
  });
});

describe("removeItem and setItemDiscount", () => {
  it("removes only the chosen line", () => {
    const items = [item(), item({ id: "line-2", variantId: "v-2" })];
    expect(removeItem(items, "line-1").map((i) => i.id)).toEqual(["line-2"]);
  });

  it("sets and clears the discount of one line", () => {
    const items = [item(), item({ id: "line-2", variantId: "v-2" })];
    const set = setItemDiscount(items, "line-2", { type: "PERCENT", bps: 1000 });
    expect(set[0]?.discount).toBeUndefined();
    expect(set[1]?.discount).toEqual({ type: "PERCENT", bps: 1000 });
    expect(setItemDiscount(set, "line-2", undefined)[1]?.discount).toBeUndefined();
  });
});

describe("summarizeCart", () => {
  const config = { taxRateBps: 1500, pricesIncludeTax: true };

  it("is empty for an empty ticket", () => {
    expect(summarizeCart([], undefined, config)).toEqual({
      priced: null,
      units: 0,
      grossCents: 0,
      discountCents: 0,
      invalidDiscount: false,
    });
  });

  it("shows the same numbers the server will compute", () => {
    // 2 × 11500 = 23000; ISV incluido: neto round(23000 × 10000 / 11500) = 20000 → ISV 3000
    const summary = summarizeCart([item({ quantity: 2 })], undefined, config);
    expect(summary).toMatchObject({ units: 2, grossCents: 23000, discountCents: 0 });
    expect(summary.priced).toMatchObject({
      subtotalCents: 23000,
      taxCents: 3000,
      totalCents: 23000,
    });
  });

  it("adds line and global discounts together", () => {
    // 2 × 11500 = 23000, línea 10 % = 2300 → 20700; global 1000 → 19700; descuentos 3300
    const summary = summarizeCart(
      [item({ quantity: 2, discount: { type: "PERCENT", bps: 1000 } })],
      { type: "AMOUNT", cents: 1000 },
      config,
    );
    expect(summary.discountCents).toBe(3300);
    expect(summary.priced?.totalCents).toBe(19700);
    expect(summary.priced?.discountCents).toBe(1000);
  });

  it("charges no ISV on exempt garments", () => {
    const summary = summarizeCart([item({ taxExempt: true })], undefined, config);
    expect(summary.priced?.taxCents).toBe(0);
    expect(summary.priced?.totalCents).toBe(11500);
  });

  it("adds the ISV on top when the prices do not include it", () => {
    // 11500 + 15 % = 1725 → 13225
    const summary = summarizeCart([item()], undefined, {
      taxRateBps: 1500,
      pricesIncludeTax: false,
    });
    expect(summary.priced).toMatchObject({ taxCents: 1725, totalCents: 13225 });
  });

  it("flags a discount bigger than the ticket instead of failing", () => {
    const summary = summarizeCart([item()], { type: "AMOUNT", cents: 11501 }, config);
    expect(summary).toMatchObject({ priced: null, invalidDiscount: true, units: 1 });
  });
});
