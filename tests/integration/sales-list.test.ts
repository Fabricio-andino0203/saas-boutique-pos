import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { openCashSession } from "@/modules/cash/service";
import { getKardex } from "@/modules/inventory/queries";
import { recordMovement } from "@/modules/inventory/service";
import { listSales } from "@/modules/sales/list-queries";
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
  const cashier2 = await make("cashier2", "CASHIER");
  const location = await testDb.location.create({
    data: { code: "MAIN", name: "Tienda principal", isDefault: true },
  });
  const terminal = await testDb.terminal.create({
    data: { name: "Caja 1", locationId: location.id },
  });
  const category = await testDb.category.create({ data: { name: "Mujer", slug: "mujer" } });
  const dress = await testDb.product.create({
    data: { code: "VES1", name: "Vestido", categoryId: category.id, basePriceCents: 11500 },
  });
  const variant = await testDb.variant.create({
    data: { productId: dress.id, sku: "VES1", barcode: "7001", avgCostCents: 4000 },
  });
  await testDb.$transaction((tx) =>
    recordMovement(tx, {
      variantId: variant.id,
      locationId: location.id,
      userId: manager.id,
      type: "INITIAL",
      quantity: 100,
    }),
  );
  await openCashSession(cashier, { openingFloatCents: 0 }, testDb);
  return { manager, cashier, cashier2, terminal, variant };
}

type World = Awaited<ReturnType<typeof world>>;

let seq = 0;
function sell(
  w: World,
  actor: Actor,
  extra: Record<string, unknown> = {},
  method: "CASH" | "CARD" = "CASH",
) {
  return completeSale(
    actor,
    {
      clientRequestId: `request-list-${(seq += 1)}`,
      lines: [{ variantId: w.variant.id, quantity: 1 }],
      payments: [{ method, amountCents: 11500 }],
      ...extra,
    },
    testDb,
  );
}

describe("listSales", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("lists the newest first with seller, total, payment methods and status", async () => {
    const w = await world();
    const a = await sell(w, w.cashier);
    const b = await sell(w, w.cashier2, {}, "CARD");
    const list = await listSales({});
    expect(list.rows.map((r) => r.number)).toEqual([b.number, a.number]);
    expect(list.rows[0]).toMatchObject({
      sellerName: "Nombre cashier2",
      totalCents: 11500,
      status: "COMPLETED",
      methods: ["CARD"],
      customerName: null,
      fiscalNumber: null,
    });
    expect(list.total).toBe(2);
    expect(list.completed).toEqual({ count: 2, totalCents: 23000 });
  });

  it("filters by status and keeps voided sales out of what was sold", async () => {
    const w = await world();
    await sell(w, w.cashier);
    const gone = await sell(w, w.cashier);
    await voidSale(w.manager, gone.id, { reason: "Se equivocó de talla" }, testDb);

    const voided = await listSales({ status: "VOIDED" });
    expect(voided.rows.map((r) => r.number)).toEqual([gone.number]);
    expect(voided.rows[0]?.status).toBe("VOIDED");

    const all = await listSales({});
    expect(all.total).toBe(2);
    expect(all.completed).toEqual({ count: 1, totalCents: 11500 });
    expect((await listSales({ status: "COMPLETED" })).total).toBe(1);
  });

  it("filters by seller, and a cashier's scope wins over whatever they ask for", async () => {
    const w = await world();
    await sell(w, w.cashier);
    await sell(w, w.cashier2);
    expect((await listSales({ sellerId: w.cashier.id })).total).toBe(1);
    expect((await listSales({}, { onlySellerId: w.cashier2.id })).rows[0]?.sellerName).toBe(
      "Nombre cashier2",
    );
    const ask = await listSales({ sellerId: w.cashier.id }, { onlySellerId: w.cashier2.id });
    expect(ask.rows.map((r) => r.sellerName)).toEqual(["Nombre cashier2"]);
  });

  it("searches by ticket number, customer and the name on the invoice", async () => {
    const w = await world();
    const customer = await testDb.customer.create({
      data: { name: "Ana Pérez", phone: "9999-0000" },
    });
    await sell(w, w.cashier, { customerId: customer.id });
    const other = await sell(w, w.cashier);
    await testDb.fiscalRange.create({
      data: {
        documentType: "INVOICE",
        terminalId: w.terminal.id,
        cai: "ABC123-CAI",
        prefix: "000-001-01-",
        rangeStart: 1,
        rangeEnd: 10,
        nextNumber: 1,
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
      },
    });
    const invoiced = await sell(w, w.cashier, { invoice: { name: "Carlos López" } });

    expect((await listSales({ q: "ana" })).total).toBe(1);
    expect((await listSales({ q: "carlos" })).rows.map((r) => r.number)).toEqual([invoiced.number]);
    expect((await listSales({ q: other.number })).rows.map((r) => r.number)).toEqual([
      other.number,
    ]);
    expect((await listSales({ q: "t-00000" })).total).toBe(3);
    expect((await listSales({ q: "nadie" })).total).toBe(0);

    // La factura sale con su número completo
    const row = (await listSales({ q: "carlos" })).rows[0];
    expect(row?.fiscalNumber).toBe("000-001-01-00000001");
    expect(row?.customerName).toBe("Carlos López");
  });

  it("filters by local date, inclusive on both ends", async () => {
    const w = await world();
    const old = await sell(w, w.cashier);
    await sell(w, w.cashier);
    // Una venta de hace 5 días
    const fiveDaysAgo = new Date(Date.now() - 5 * 86_400_000);
    await testDb.sale.update({ where: { id: old.id }, data: { createdAt: fiveDaysAgo } });

    const day = (date: Date) => {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Tegucigalpa",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(date);
      return parts;
    };
    const today = day(new Date());
    const oldDay = day(fiveDaysAgo);

    expect((await listSales({ from: today, to: today })).total).toBe(1);
    expect((await listSales({ from: oldDay, to: oldDay })).rows.map((r) => r.number)).toEqual([
      old.number,
    ]);
    expect((await listSales({ from: oldDay, to: today })).total).toBe(2);
    expect((await listSales({ from: today })).total).toBe(1);
    expect((await listSales({ to: oldDay })).total).toBe(1);
    expect((await listSales({})).total).toBe(2);
  });

  it("pages the results", async () => {
    const w = await world();
    for (let index = 0; index < 22; index += 1) {
      await sell(w, w.cashier);
    }
    const first = await listSales({ page: 1 });
    const second = await listSales({ page: 2 });
    expect([first.rows.length, second.rows.length, first.total, first.pageSize]).toEqual([
      20, 2, 22, 20,
    ]);
    expect(new Set([...first.rows, ...second.rows].map((r) => r.id)).size).toBe(22);
    expect((await listSales({ page: 0 })).page).toBe(1);
  });

  it("links the kardex movements of a sale to its ticket", async () => {
    const w = await world();
    const result = await sell(w, w.cashier);
    const kardex = await getKardex(w.variant.id, {}, testDb);
    const row = kardex?.rows.find((r) => r.type === "SALE_OUT");
    expect(row?.document).toEqual({ label: result.number, href: `/ventas/${result.id}` });
  });
});
