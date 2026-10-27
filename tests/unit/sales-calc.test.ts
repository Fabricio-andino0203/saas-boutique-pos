import { describe, expect, it } from "vitest";

import { ValidationError } from "@/lib/errors";
import {
  discountCentsOf,
  discountExceedsLimit,
  priceCart,
  settlePayments,
  type CartLine,
} from "@/modules/sales/calc";
import {
  managerOverrideSchema,
  paymentSchema,
  saleInputSchema,
  voidSaleSchema,
} from "@/modules/sales/schemas";

const ISV = 1500;
const line = (
  unitPriceCents: number,
  quantity: number,
  extra: Partial<CartLine> = {},
): CartLine => ({
  unitPriceCents,
  quantity,
  taxRateBps: ISV,
  ...extra,
});

describe("priceCart (prices include ISV)", () => {
  it("extracts the ISV from the line total without changing the total", () => {
    // 2 × 11500 = 23000; neto = round(23000 × 10000 / 11500) = 20000; ISV = 23000 − 20000 = 3000
    const cart = priceCart([line(11500, 2)], { pricesIncludeTax: true });
    expect(cart).toEqual({
      lines: [
        {
          grossCents: 23000,
          ownDiscountCents: 0,
          discountCents: 0,
          taxCents: 3000,
          lineTotalCents: 23000,
        },
      ],
      subtotalCents: 23000,
      discountCents: 0,
      taxCents: 3000,
      totalCents: 23000,
    });
  });

  it("applies line discounts, then prorates the global one between the lines", () => {
    // Línea 1: 3 × 10000 = 30000, 10 % → 3000, neto 27000. Línea 2: 1 × 5000, neto 5000. Subtotal 32000.
    // Global L 32.00 de 320.00 (10 %): 3200 × 27000 / 32000 = 2700 y 3200 × 5000 / 32000 = 500.
    // Después: 24300 y 4500 (suma 28800 = 32000 − 3200).
    // ISV línea 1: neto round(243000000 / 11500 = 21130.43) = 21130 → 3170. Línea 2: round(45000000 / 11500 = 3913.04) = 3913 → 587.
    const cart = priceCart(
      [line(10000, 3, { discount: { type: "PERCENT", bps: 1000 } }), line(5000, 1)],
      { globalDiscount: { type: "AMOUNT", cents: 3200 }, pricesIncludeTax: true },
    );
    expect(cart.lines).toEqual([
      {
        grossCents: 30000,
        ownDiscountCents: 3000,
        discountCents: 5700,
        taxCents: 3170,
        lineTotalCents: 24300,
      },
      {
        grossCents: 5000,
        ownDiscountCents: 0,
        discountCents: 500,
        taxCents: 587,
        lineTotalCents: 4500,
      },
    ]);
    expect(cart.subtotalCents).toBe(32000);
    expect(cart.discountCents).toBe(3200);
    expect(cart.taxCents).toBe(3757);
    expect(cart.totalCents).toBe(28800);
  });

  it("never loses a cent when the global discount does not divide evenly", () => {
    // Tres líneas de 10001 (suma 30003) y descuento 100: 33,33 cada una → [34, 33, 33] (el resto va al índice más bajo).
    const cart = priceCart([line(10001, 1), line(10001, 1), line(10001, 1)], {
      globalDiscount: { type: "AMOUNT", cents: 100 },
      pricesIncludeTax: true,
    });
    expect(cart.lines.map((l) => l.discountCents)).toEqual([34, 33, 33]);
    expect(cart.lines.map((l) => l.lineTotalCents)).toEqual([9967, 9968, 9968]);
    expect(cart.totalCents).toBe(29903); // 30003 − 100
  });

  it("charges no ISV on exempt garments", () => {
    const cart = priceCart([line(8000, 1, { taxRateBps: 0 })], { pricesIncludeTax: true });
    expect(cart.taxCents).toBe(0);
    expect(cart.totalCents).toBe(8000);
  });

  it("reads a percentage discount over the line gross", () => {
    // 333 pb de 10001: 10001 × 333 / 10000 = 333,03 → 333
    const cart = priceCart([line(10001, 1, { discount: { type: "PERCENT", bps: 333 } })], {
      pricesIncludeTax: true,
    });
    expect(cart.lines[0]?.ownDiscountCents).toBe(333);
    expect(cart.totalCents).toBe(9668);
  });
});

describe("priceCart (prices exclude ISV)", () => {
  it("adds the ISV on top of the price", () => {
    // 10000 + 15 % = 1500 → 11500
    const cart = priceCart([line(10000, 1)], { pricesIncludeTax: false });
    expect(cart).toMatchObject({ subtotalCents: 10000, taxCents: 1500, totalCents: 11500 });
  });

  it("charges the ISV on the discounted price", () => {
    // 10000 − 10 % = 9000; ISV 15 % de 9000 = 1350; línea 10350
    const cart = priceCart([line(10000, 1, { discount: { type: "PERCENT", bps: 1000 } })], {
      pricesIncludeTax: false,
    });
    expect(cart.lines[0]).toEqual({
      grossCents: 10000,
      ownDiscountCents: 1000,
      discountCents: 1000,
      taxCents: 1350,
      lineTotalCents: 10350,
    });
    expect(cart.totalCents).toBe(10350);
  });
});

describe("priceCart (refusals)", () => {
  it("refuses an empty cart", () => {
    expect(() => priceCart([], { pricesIncludeTax: true })).toThrow(ValidationError);
  });

  it("refuses a discount bigger than the line or the subtotal", () => {
    expect(() =>
      priceCart([line(10000, 3, { discount: { type: "AMOUNT", cents: 30001 } })], {
        pricesIncludeTax: true,
      }),
    ).toThrow(ValidationError);
    expect(() =>
      priceCart([line(10000, 1)], {
        globalDiscount: { type: "AMOUNT", cents: 10001 },
        pricesIncludeTax: true,
      }),
    ).toThrow(ValidationError);
  });

  it("allows a discount equal to the whole amount (the service decides if a free sale is valid)", () => {
    const cart = priceCart([line(10000, 1)], {
      globalDiscount: { type: "PERCENT", bps: 10000 },
      pricesIncludeTax: true,
    });
    expect(cart.totalCents).toBe(0);
    expect(cart.taxCents).toBe(0);
  });
});

describe("discountCentsOf", () => {
  it("is zero without a discount and exact for a fixed amount", () => {
    expect(discountCentsOf(5000, undefined)).toBe(0);
    expect(discountCentsOf(5000, { type: "AMOUNT", cents: 5000 })).toBe(5000);
  });
});

describe("discountExceedsLimit", () => {
  it("compares a percentage as it was asked, not as it rounds", () => {
    expect(discountExceedsLimit({ type: "PERCENT", bps: 1000 }, 9999, 10)).toBe(false);
    expect(discountExceedsLimit({ type: "PERCENT", bps: 1001 }, 9999, 10)).toBe(true);
  });

  it("compares a fixed amount against the base", () => {
    // 1000 de 10000 es justo 10 %: no pasa. 1001 sí.
    expect(discountExceedsLimit({ type: "AMOUNT", cents: 1000 }, 10000, 10)).toBe(false);
    expect(discountExceedsLimit({ type: "AMOUNT", cents: 1001 }, 10000, 10)).toBe(true);
  });

  it("treats a limit of zero as no discounts at all, and no discount as fine", () => {
    expect(discountExceedsLimit({ type: "PERCENT", bps: 1 }, 10000, 0)).toBe(true);
    expect(discountExceedsLimit(undefined, 10000, 0)).toBe(false);
  });
});

describe("settlePayments", () => {
  it("gives change from cash", () => {
    expect(settlePayments(23000, [{ method: "CASH", amountCents: 25000 }])).toEqual({
      paidCents: 25000,
      changeCents: 2000,
    });
  });

  it("accepts an exact payment", () => {
    expect(settlePayments(23000, [{ method: "CARD", amountCents: 23000 }])).toEqual({
      paidCents: 23000,
      changeCents: 0,
    });
  });

  it("takes mixed payments and gives the change from the cash part", () => {
    // 10000 con tarjeta + 15000 en efectivo = 25000; vuelto 2000 ≤ 15000 en efectivo
    expect(
      settlePayments(23000, [
        { method: "CARD", amountCents: 10000 },
        { method: "CASH", amountCents: 15000 },
      ]),
    ).toEqual({ paidCents: 25000, changeCents: 2000 });
  });

  it("refuses to pay less than the total", () => {
    expect(() => settlePayments(23000, [{ method: "CASH", amountCents: 22999 }])).toThrow(
      ValidationError,
    );
  });

  it("refuses change that would come from a card or a transfer", () => {
    expect(() => settlePayments(23000, [{ method: "CARD", amountCents: 24000 }])).toThrow(
      ValidationError,
    );
    // 20000 con tarjeta + 5000 en efectivo = 25000; vuelto 2000 ≤ 5000: sí se puede
    expect(
      settlePayments(23000, [
        { method: "CARD", amountCents: 20000 },
        { method: "CASH", amountCents: 5000 },
      ]).changeCents,
    ).toBe(2000);
    // 24000 con tarjeta + 1000 en efectivo = 25000; vuelto 2000 > 1000 en efectivo: no
    expect(() =>
      settlePayments(23000, [
        { method: "CARD", amountCents: 24000 },
        { method: "CASH", amountCents: 1000 },
      ]),
    ).toThrow(ValidationError);
  });
});

describe("sale schemas", () => {
  const valid = {
    clientRequestId: "req-12345678",
    lines: [{ variantId: "v1", quantity: 1 }],
    payments: [{ method: "CASH", amountCents: 1000 }],
  };

  it("accepts a minimal sale and a sale with everything", () => {
    expect(saleInputSchema.safeParse(valid).success).toBe(true);
    expect(
      saleInputSchema.safeParse({
        ...valid,
        discount: { type: "PERCENT", bps: 500 },
        customerId: "c1",
        invoice: { taxId: " 0801-1990-00001 ", name: "" },
        managerOverride: { username: "manager", pin: "2222" },
      }).success,
    ).toBe(true);
  });

  it("treats blank invoice fields as missing", () => {
    const parsed = saleInputSchema.parse({ ...valid, invoice: { taxId: "  ", name: "" } });
    expect(parsed.invoice).toEqual({ taxId: undefined, name: undefined });
  });

  it("rejects a short request id, no lines, no payments and absurd quantities", () => {
    expect(saleInputSchema.safeParse({ ...valid, clientRequestId: "abc" }).success).toBe(false);
    expect(saleInputSchema.safeParse({ ...valid, lines: [] }).success).toBe(false);
    expect(saleInputSchema.safeParse({ ...valid, payments: [] }).success).toBe(false);
    expect(
      saleInputSchema.safeParse({ ...valid, lines: [{ variantId: "v1", quantity: 0 }] }).success,
    ).toBe(false);
    expect(
      saleInputSchema.safeParse({ ...valid, lines: [{ variantId: "v1", quantity: 1.5 }] }).success,
    ).toBe(false);
  });

  it("rejects bad discounts and payment methods", () => {
    expect(
      saleInputSchema.safeParse({ ...valid, discount: { type: "PERCENT", bps: 10001 } }).success,
    ).toBe(false);
    expect(
      saleInputSchema.safeParse({ ...valid, discount: { type: "AMOUNT", cents: 0 } }).success,
    ).toBe(false);
    // El crédito de tienda se cobra; el pago "Cambio" lo crea el servidor, nunca el cliente
    expect(paymentSchema.safeParse({ method: "STORE_CREDIT", amountCents: 100 }).success).toBe(
      true,
    );
    expect(paymentSchema.safeParse({ method: "EXCHANGE", amountCents: 100 }).success).toBe(false);
    expect(paymentSchema.safeParse({ method: "CASH", amountCents: 0 }).success).toBe(false);
  });

  it("only takes numeric PINs of 4 to 6 digits", () => {
    expect(managerOverrideSchema.safeParse({ username: "m", pin: "1234" }).success).toBe(true);
    expect(managerOverrideSchema.safeParse({ username: "m", pin: "123" }).success).toBe(false);
    expect(managerOverrideSchema.safeParse({ username: "m", pin: "12a4" }).success).toBe(false);
    expect(managerOverrideSchema.safeParse({ username: "m", pin: "1234567" }).success).toBe(false);
  });

  it("needs a reason to void", () => {
    expect(voidSaleSchema.safeParse({ reason: "Se equivocó de talla" }).success).toBe(true);
    expect(voidSaleSchema.safeParse({ reason: " ab " }).success).toBe(false);
    expect(voidSaleSchema.safeParse({}).success).toBe(false);
  });
});
