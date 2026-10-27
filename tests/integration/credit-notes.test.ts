import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { openCashSession } from "@/modules/cash/service";
import { recordMovement } from "@/modules/inventory/service";
import { getReturnDocument } from "@/modules/returns/queries";
import { processExchange, processReturn } from "@/modules/returns/service";
import { listSales } from "@/modules/sales/list-queries";
import { completeSale } from "@/modules/sales/service";

import { closeDatabase, resetDatabase, testDb } from "./helpers/db";

const closeAll = async () => {
  await db.$disconnect();
  await closeDatabase();
};

type Actor = { id: string; role: Role };

const DAY = 86_400_000;

async function world() {
  const make = async (username: string, role: Role): Promise<Actor> => {
    const user = await testDb.user.create({
      data: { name: `Nombre ${username}`, username, passwordHash: "x", role },
    });
    return { id: user.id, role };
  };
  const owner = await make("owner", "OWNER");
  const cashier = await make("cashier", "CASHIER");

  const location = await testDb.location.create({
    data: { code: "MAIN", name: "Tienda principal", isDefault: true },
  });
  const terminal = await testDb.terminal.create({
    data: { name: "Caja 1", locationId: location.id },
  });
  const category = await testDb.category.create({ data: { name: "Mujer", slug: "mujer" } });
  const variant = async (code: string, price: number) => {
    const product = await testDb.product.create({
      data: { code, name: `Producto ${code}`, categoryId: category.id, basePriceCents: price },
    });
    const created = await testDb.variant.create({
      data: { productId: product.id, sku: code, barcode: `BC-${code}`, avgCostCents: 4000 },
    });
    await testDb.$transaction((tx) =>
      recordMovement(tx, {
        variantId: created.id,
        locationId: location.id,
        userId: owner.id,
        type: "INITIAL",
        quantity: 50,
      }),
    );
    return created;
  };
  const dress = await variant("VES1", 11500);
  const dress2 = await variant("VES2", 11500);
  const ana = await testDb.customer.create({ data: { name: "Ana Pérez", phone: "9999-0000" } });
  await openCashSession(cashier, { openingFloatCents: 50000 }, testDb);
  return { owner, cashier, terminal, dress, dress2, ana };
}

type World = Awaited<ReturnType<typeof world>>;

let seq = 0;
const requestId = () => `request-note-${(seq += 1)}`;

async function range(
  w: World,
  type: "INVOICE" | "CREDIT_NOTE",
  overrides: { expiresAt?: Date; nextNumber?: number; rangeEnd?: number; isActive?: boolean } = {},
) {
  return testDb.fiscalRange.create({
    data: {
      documentType: type,
      terminalId: w.terminal.id,
      cai: `CAI-${type}-1`,
      prefix: type === "INVOICE" ? "000-001-01-" : "000-001-03-",
      rangeStart: 1,
      rangeEnd: overrides.rangeEnd ?? 100,
      nextNumber: overrides.nextNumber ?? 1,
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 30 * DAY),
      isActive: overrides.isActive ?? true,
    },
  });
}

/** Una venta a Ana; con `invoiced` sale con factura con CAI. */
async function sell(w: World, invoiced: boolean, quantity = 1) {
  const sale = await completeSale(
    w.cashier,
    {
      clientRequestId: requestId(),
      lines: [{ variantId: w.dress.id, quantity }],
      payments: [{ method: "CASH", amountCents: 11500 * quantity }],
      customerId: w.ana.id,
      ...(invoiced ? { invoice: { taxId: "0801-1990-12345", name: "Ana Pérez" } } : {}),
    },
    testDb,
  );
  const [item] = await testDb.saleItem.findMany({ where: { saleId: sale.id } });
  return { sale, item: item! };
}

function giveBack(w: World, saleId: string, saleItemId: string, quantity = 1, id = requestId()) {
  return processReturn(
    w.cashier,
    {
      clientRequestId: id,
      saleId,
      items: [{ saleItemId, quantity, condition: "RESELLABLE" }],
      reason: "No le gustó",
      refundMethod: "STORE_CREDIT",
    },
    testDb,
  );
}

const nextNumber = async (rangeId: string) =>
  (await testDb.fiscalRange.findUniqueOrThrow({ where: { id: rangeId } })).nextNumber;

describe("credit notes on returns of invoiced sales", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("issues the next credit note of the range, with its CAI on the receipt", async () => {
    const w = await world();
    await range(w, "INVOICE");
    const notes = await range(w, "CREDIT_NOTE");
    const { sale, item } = await sell(w, true, 2);

    const first = await giveBack(w, sale.id, item.id, 1);
    expect(first).toMatchObject({
      creditNote: "000-001-03-00000001",
      creditNoteMissing: false,
      replayed: false,
    });
    const doc = await testDb.returnDoc.findUniqueOrThrow({ where: { id: first.id } });
    expect(doc).toMatchObject({ fiscalNumber: 1, fiscalRangeId: notes.id });
    expect(await nextNumber(notes.id)).toBe(2);

    // La segunda devolución usa el siguiente número: correlativo y sin saltos
    const second = await giveBack(w, sale.id, item.id, 1);
    expect(second.creditNote).toBe("000-001-03-00000002");

    const receipt = await getReturnDocument(first.id);
    expect(receipt?.creditNote).toMatchObject({
      number: "000-001-03-00000001",
      cai: "CAI-CREDIT_NOTE-1",
      rangeStart: "000-001-03-00000001",
      rangeEnd: "000-001-03-00000100",
      originalInvoice: sale.fiscalNumber,
      customerTaxId: "0801-1990-12345",
      customerName: "Ana Pérez",
    });
    const log = await testDb.auditLog.findFirstOrThrow({
      where: { action: "RETURN_PROCESSED", entityId: first.id },
    });
    expect(log.after).toMatchObject({ creditNote: "000-001-03-00000001" });
  });

  it("does not issue one for a sale without an invoice", async () => {
    const w = await world();
    const notes = await range(w, "CREDIT_NOTE");
    const { sale, item } = await sell(w, false);
    const result = await giveBack(w, sale.id, item.id);
    expect(result).toMatchObject({ creditNote: null, creditNoteMissing: false });
    expect(await nextNumber(notes.id)).toBe(1);
    expect((await getReturnDocument(result.id))?.creditNote).toBeNull();
  });

  it("goes ahead without it, and says so, when there is no usable credit note range", async () => {
    const w = await world();
    await range(w, "INVOICE");
    const { sale, item } = await sell(w, true, 4);

    // Sin ningún rango de notas de crédito
    const none = await giveBack(w, sale.id, item.id);
    expect(none).toMatchObject({ creditNote: null, creditNoteMissing: true });
    expect(await testDb.returnDoc.findUniqueOrThrow({ where: { id: none.id } })).toMatchObject({
      fiscalNumber: null,
      fiscalRangeId: null,
    });
    // la devolución sí se hizo: prenda al inventario y crédito al cliente
    expect(
      (await testDb.customer.findUniqueOrThrow({ where: { id: w.ana.id } })).storeCreditCents,
    ).toBe(11500);

    // Con un rango vencido
    const expired = await range(w, "CREDIT_NOTE", { expiresAt: new Date(Date.now() - 2 * DAY) });
    const late = await giveBack(w, sale.id, item.id);
    expect(late.creditNoteMissing).toBe(true);
    expect(await nextNumber(expired.id)).toBe(1);
    await testDb.fiscalRange.update({ where: { id: expired.id }, data: { isActive: false } });

    // Con un rango agotado
    const used = await range(w, "CREDIT_NOTE", { nextNumber: 11, rangeEnd: 10 });
    const out = await giveBack(w, sale.id, item.id);
    expect(out.creditNoteMissing).toBe(true);
    expect(await nextNumber(used.id)).toBe(11);
    expect(await testDb.returnDoc.count()).toBe(3);
    expect(
      await testDb.auditLog.count({
        where: { action: "RETURN_PROCESSED", after: { path: ["creditNoteMissing"], equals: true } },
      }),
    ).toBe(3);
  });

  it("issues a single note when the same request is sent again, even at once", async () => {
    const w = await world();
    const notes = await range(w, "CREDIT_NOTE");
    await range(w, "INVOICE");
    const { sale, item } = await sell(w, true);
    const id = requestId();
    const results = await Promise.all([1, 2, 3].map(() => giveBack(w, sale.id, item.id, 1, id)));
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(new Set(results.map((r) => r.creditNote))).toEqual(new Set(["000-001-03-00000001"]));
    expect(await nextNumber(notes.id)).toBe(2);
  });

  it("gives distinct consecutive numbers to returns that race", async () => {
    const w = await world();
    const notes = await range(w, "CREDIT_NOTE");
    await range(w, "INVOICE");
    const first = await sell(w, true);
    const second = await sell(w, true);
    const results = await Promise.all([
      giveBack(w, first.sale.id, first.item.id),
      giveBack(w, second.sale.id, second.item.id),
    ]);
    expect(results.map((r) => r.creditNote).sort()).toEqual([
      "000-001-03-00000001",
      "000-001-03-00000002",
    ]);
    expect(await nextNumber(notes.id)).toBe(3);
  });

  it("also issues the note for the returned part of an exchange, besides the new sale's own invoice", async () => {
    const w = await world();
    const invoices = await range(w, "INVOICE");
    const notes = await range(w, "CREDIT_NOTE");
    const { sale, item } = await sell(w, true);
    const result = await processExchange(
      w.cashier,
      {
        clientRequestId: requestId(),
        saleId: sale.id,
        items: [{ saleItemId: item.id, quantity: 1, condition: "RESELLABLE" }],
        reason: "Talla incorrecta",
        newLines: [{ variantId: w.dress2.id, quantity: 1 }],
        payments: [],
        invoice: { taxId: "0801-1990-12345", name: "Ana Pérez" },
      },
      testDb,
    );
    expect(result.creditNote).toBe("000-001-03-00000001");
    expect(result.exchange?.fiscalNumber).toBe("000-001-01-00000002");
    expect(await nextNumber(notes.id)).toBe(2);
    expect(await nextNumber(invoices.id)).toBe(3);
  });

  it("keeps the credit note number free when the whole exchange is rolled back", async () => {
    const w = await world();
    await range(w, "INVOICE");
    const notes = await range(w, "CREDIT_NOTE");
    const { sale, item } = await sell(w, true);
    await expect(
      processExchange(
        w.cashier,
        {
          clientRequestId: requestId(),
          saleId: sale.id,
          items: [{ saleItemId: item.id, quantity: 1, condition: "RESELLABLE" }],
          reason: "Talla incorrecta",
          newLines: [{ variantId: "no-existe", quantity: 1 }],
          payments: [],
        },
        testDb,
      ),
    ).rejects.toThrow();
    expect(await nextNumber(notes.id)).toBe(1);
    expect(await testDb.returnDoc.count()).toBe(0);
  });
});

describe("sales history", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("shows how many garments of each sale came back", async () => {
    const w = await world();
    const { sale, item } = await sell(w, false, 3);
    const untouched = await sell(w, false);
    const unitsOf = async (id: string) =>
      (await listSales({}, {})).rows.find((row) => row.id === id);

    expect(await unitsOf(sale.id)).toMatchObject({ soldUnits: 3, returnedUnits: 0 });
    await giveBack(w, sale.id, item.id, 2);
    expect(await unitsOf(sale.id)).toMatchObject({ soldUnits: 3, returnedUnits: 2 });
    await giveBack(w, sale.id, item.id, 1);
    expect(await unitsOf(sale.id)).toMatchObject({ soldUnits: 3, returnedUnits: 3 });
    expect(await unitsOf(untouched.sale.id)).toMatchObject({ soldUnits: 1, returnedUnits: 0 });
  });
});
