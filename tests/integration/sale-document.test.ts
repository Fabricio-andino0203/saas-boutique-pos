import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { setSetting } from "@/lib/settings";
import { openCashSession } from "@/modules/cash/service";
import { recordMovement } from "@/modules/inventory/service";
import { getSaleDocument } from "@/modules/sales/queries";
import { completeSale, voidSale } from "@/modules/sales/service";

import { closeDatabase, resetDatabase, testDb } from "./helpers/db";

const closeAll = async () => {
  await db.$disconnect();
  await closeDatabase();
};

type Actor = { id: string; role: Role };

async function world() {
  const make = async (username: string, role: Role): Promise<Actor> => {
    const user = await testDb.user.create({
      data: { name: `Nombre ${username}`, username, passwordHash: "x", role },
    });
    return { id: user.id, role };
  };
  const manager = await make("manager", "MANAGER");
  const cashier = await make("cashier", "CASHIER");
  const location = await testDb.location.create({
    data: { code: "MAIN", name: "Tienda principal", isDefault: true },
  });
  const terminal = await testDb.terminal.create({
    data: { name: "Caja 1", locationId: location.id },
  });
  const category = await testDb.category.create({ data: { name: "Mujer", slug: "mujer" } });
  const size = await testDb.size.create({ data: { name: "M", sortOrder: 1 } });
  const color = await testDb.color.create({ data: { name: "Azul", hex: "#0000cc" } });
  const dress = await testDb.product.create({
    data: { code: "VES1", name: "Vestido", categoryId: category.id, basePriceCents: 11500 },
  });
  const book = await testDb.product.create({
    data: {
      code: "LIB1",
      name: "Libro",
      categoryId: category.id,
      basePriceCents: 5000,
      taxCategory: "EXEMPT",
    },
  });
  const dressV = await testDb.variant.create({
    data: {
      productId: dress.id,
      sku: "VES1-M",
      barcode: "7001",
      sizeId: size.id,
      colorId: color.id,
      avgCostCents: 4000,
    },
  });
  const bookV = await testDb.variant.create({
    data: { productId: book.id, sku: "LIB1", barcode: "7002", avgCostCents: 2000 },
  });
  for (const variant of [dressV, bookV]) {
    await testDb.$transaction((tx) =>
      recordMovement(tx, {
        variantId: variant.id,
        locationId: location.id,
        userId: manager.id,
        type: "INITIAL",
        quantity: 10,
      }),
    );
  }
  await testDb.businessProfile.create({
    data: {
      legalName: "Boutique Demo S. de R.L.",
      tradeName: "Boutique Demo",
      taxId: "0801-1999-123456",
      address: "Col. Centro, Tegucigalpa",
      phone: "2222-3333",
    },
  });
  await setSetting(testDb, "ticket.footer", "¡Vuelve pronto!");
  await openCashSession(cashier, { openingFloatCents: 0 }, testDb);
  return { manager, cashier, terminal, dressV, bookV };
}

type World = Awaited<ReturnType<typeof world>>;

let seq = 0;
const sell = (
  w: World,
  lines: { variantId: string; quantity: number }[],
  payments: { method: "CASH" | "CARD"; amountCents: number; reference?: string }[],
  extra: Record<string, unknown> = {},
) =>
  completeSale(
    w.cashier,
    { clientRequestId: `request-doc-${(seq += 1)}`, lines, payments, ...extra },
    testDb,
  );

describe("getSaleDocument", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("is null for a sale that does not exist", async () => {
    await world();
    expect(await getSaleDocument("no-existe")).toBeNull();
  });

  it("collects everything a ticket prints", async () => {
    const w = await world();
    const customer = await testDb.customer.create({ data: { name: "Ana", phone: "9999-0000" } });
    // 2 × 11500 = 23000 y un libro de 5000; descuento global de 10 % de 28000 = 2800
    const result = await sell(
      w,
      [
        { variantId: w.dressV.id, quantity: 2 },
        { variantId: w.bookV.id, quantity: 1 },
      ],
      [
        { method: "CARD", amountCents: 10000, reference: "4242" },
        { method: "CASH", amountCents: 20000 },
      ],
      { discount: { type: "PERCENT", bps: 1000 }, customerId: customer.id },
    );
    const doc = await getSaleDocument(result.id);
    expect(doc).toMatchObject({
      id: result.id,
      number: "T-000001",
      status: "COMPLETED",
      sellerName: "Nombre cashier",
      customer: { name: "Ana", phone: "9999-0000" },
      grossCents: 28000,
      discountCents: 2800,
      totalCents: 25200,
      paidCents: 30000,
      changeCents: 4800,
      taxIncluded: true,
      invoice: null,
      voided: null,
      footer: "¡Vuelve pronto!",
      business: {
        legalName: "Boutique Demo S. de R.L.",
        tradeName: "Boutique Demo",
        taxId: "0801-1999-123456",
        address: "Col. Centro, Tegucigalpa",
        phone: "2222-3333",
      },
    });
    expect(doc?.items.map((i) => [i.productName, i.sizeName, i.colorName, i.quantity])).toEqual([
      ["Vestido", "M", "Azul", 2],
      ["Libro", null, null, 1],
    ]);
    // Los descuentos por línea suman el descuento global (prorrateado entre las líneas)
    expect(doc?.items.reduce((sum, i) => sum + i.lineDiscountCents, 0)).toBe(2800);
    expect(doc?.items.reduce((sum, i) => sum + i.lineTotalCents, 0)).toBe(25200);
    expect(doc?.payments).toEqual([
      { method: "CARD", amountCents: 10000, reference: "4242" },
      { method: "CASH", amountCents: 20000, reference: null },
    ]);
  });

  it("describes the invoice with its fiscal range", async () => {
    const w = await world();
    const expiresAt = new Date("2027-06-30T18:00:00.000Z");
    await testDb.fiscalRange.create({
      data: {
        documentType: "INVOICE",
        terminalId: w.terminal.id,
        cai: "ABC123-CAI",
        prefix: "000-001-01-",
        rangeStart: 1,
        rangeEnd: 500,
        nextNumber: 41,
        expiresAt,
      },
    });
    const result = await sell(
      w,
      [{ variantId: w.dressV.id, quantity: 1 }],
      [{ method: "CASH", amountCents: 11500 }],
      {
        invoice: { taxId: "0801-1990-00001", name: "Ana Pérez" },
      },
    );
    const doc = await getSaleDocument(result.id);
    expect(doc?.invoice).toEqual({
      type: "INVOICE",
      number: "000-001-01-00000041",
      cai: "ABC123-CAI",
      rangeStart: "000-001-01-00000001",
      rangeEnd: "000-001-01-00000500",
      expiresAt,
      customerTaxId: "0801-1990-00001",
      customerName: "Ana Pérez",
    });
  });

  it("knows when the ISV was added on top instead of included", async () => {
    const w = await world();
    await setSetting(testDb, "tax.pricesIncludeTax", false);
    // 11500 + 15 % = 13225
    const result = await sell(
      w,
      [{ variantId: w.dressV.id, quantity: 1 }],
      [{ method: "CASH", amountCents: 13225 }],
    );
    const doc = await getSaleDocument(result.id);
    expect(doc).toMatchObject({
      grossCents: 11500,
      taxCents: 1725,
      totalCents: 13225,
      taxIncluded: false,
    });
  });

  it("marks a voided sale with when and why", async () => {
    const w = await world();
    const result = await sell(
      w,
      [{ variantId: w.dressV.id, quantity: 1 }],
      [{ method: "CASH", amountCents: 11500 }],
    );
    await voidSale(w.manager, result.id, { reason: "Se equivocó de talla" }, testDb);
    const doc = await getSaleDocument(result.id);
    expect(doc?.status).toBe("VOIDED");
    expect(doc?.voided).toMatchObject({ reason: "Se equivocó de talla" });
    expect(doc?.voided?.at).toBeInstanceOf(Date);
  });
});
