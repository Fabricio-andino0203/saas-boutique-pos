import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import {
  CustomerRequiredError,
  ForbiddenError,
  InsufficientCreditError,
  NotFoundError,
  SaleStateError,
  ValidationError,
} from "@/lib/errors";
import type { Role } from "@/lib/permissions";
import { expectedCashCents } from "@/modules/cash/expected";
import { loadCashTotals, openCashSession } from "@/modules/cash/service";
import { adjustStoreCredit } from "@/modules/customers/credit";
import { getCustomerCreditCents, getCustomerFicha } from "@/modules/customers/queries";
import { findStockDiscrepancies } from "@/modules/inventory/reconcile";
import { recordMovement } from "@/modules/inventory/service";
import { processExchange, processReturn } from "@/modules/returns/service";
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
  const owner = await make("owner", "OWNER");
  const manager = await make("manager", "MANAGER");
  const cashier = await make("cashier", "CASHIER");
  const warehouse = await make("warehouse", "WAREHOUSE");

  const location = await testDb.location.create({
    data: { code: "MAIN", name: "Tienda principal", isDefault: true },
  });
  await testDb.terminal.create({ data: { name: "Caja 1", locationId: location.id } });
  const category = await testDb.category.create({ data: { name: "Mujer", slug: "mujer" } });
  const variant = async (code: string, price: number, stock: number) => {
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
        quantity: stock,
      }),
    );
    return created;
  };
  const dress = await variant("VES1", 11500, 50);
  const dress2 = await variant("VES2", 11500, 50);
  const shirt = await variant("CAM1", 20000, 50);
  const ana = await testDb.customer.create({ data: { name: "Ana Pérez", phone: "9999-0000" } });
  const luis = await testDb.customer.create({ data: { name: "Luis Mejía", phone: "8888-0000" } });
  const shift = await openCashSession(cashier, { openingFloatCents: 50000 }, testDb);
  return { owner, manager, cashier, warehouse, dress, dress2, shirt, ana, luis, shiftId: shift.id };
}

type World = Awaited<ReturnType<typeof world>>;

let seq = 0;
const requestId = () => `request-credit-${(seq += 1)}`;

/** Le da crédito a un cliente por el camino de verdad: un ajuste manual de un gerente. */
async function giveCredit(w: World, customerId: string, amountCents: number) {
  await adjustStoreCredit(
    w.manager,
    {
      requestId: requestId(),
      customerId,
      direction: "ADD",
      amountCents,
      reason: "Crédito de prueba",
    },
    testDb,
  );
}

const balanceOf = async (customerId: string) =>
  (await testDb.customer.findUniqueOrThrow({ where: { id: customerId } })).storeCreditCents;

const onHand = async (variantId: string) =>
  (await testDb.stockLevel.findFirst({ where: { variantId } }))?.onHand ?? 0;

function sale(
  w: World,
  variantId: string,
  payments: { method: "CASH" | "STORE_CREDIT"; amountCents: number }[],
  customerId?: string,
  id = requestId(),
) {
  return completeSale(
    w.cashier,
    {
      clientRequestId: id,
      lines: [{ variantId, quantity: 1 }],
      payments,
      ...(customerId ? { customerId } : {}),
    },
    testDb,
  );
}

async function expectLedgerMatchesCache() {
  for (const customer of await testDb.customer.findMany({
    include: { storeCreditEntries: true },
  })) {
    expect(
      customer.storeCreditEntries.reduce((sum, entry) => sum + entry.amountCents, 0),
      customer.name,
    ).toBe(customer.storeCreditCents);
    expect(customer.storeCreditCents).toBeGreaterThanOrEqual(0);
  }
}

describe("paying a sale with store credit", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("takes the credit out of the ledger and leaves the drawer alone", async () => {
    const w = await world();
    await giveCredit(w, w.ana.id, 20000);
    const result = await sale(
      w,
      w.dress.id,
      [{ method: "STORE_CREDIT", amountCents: 11500 }],
      w.ana.id,
    );

    expect(result).toMatchObject({
      number: "T-000001",
      totalCents: 11500,
      paidCents: 11500,
      changeCents: 0,
    });
    expect(await balanceOf(w.ana.id)).toBe(8500);
    const entries = await testDb.storeCreditEntry.findMany({
      where: { customerId: w.ana.id },
      orderBy: { createdAt: "asc" },
    });
    expect(entries.map((e) => [e.amountCents, e.reason, e.refType])).toEqual([
      [20000, "MANUAL", "Adjustment"],
      [-11500, "USED_IN_SALE", "Sale"],
    ]);
    expect(entries[1]?.refId).toBe(result.id);
    const totals = await loadCashTotals(testDb, w.shiftId);
    expect(totals.cashPaymentsCents).toBe(0);
    expect(expectedCashCents(totals)).toBe(50000);
    await expectLedgerMatchesCache();
  });

  it("can be combined with cash", async () => {
    const w = await world();
    await giveCredit(w, w.ana.id, 5000);
    const result = await sale(
      w,
      w.dress.id,
      [
        { method: "STORE_CREDIT", amountCents: 5000 },
        { method: "CASH", amountCents: 6500 },
      ],
      w.ana.id,
    );
    expect(result).toMatchObject({ totalCents: 11500, paidCents: 11500, changeCents: 0 });
    expect(await balanceOf(w.ana.id)).toBe(0);
    expect(expectedCashCents(await loadCashTotals(testDb, w.shiftId))).toBe(56500);
  });

  it("needs a customer, and does nothing without one", async () => {
    const w = await world();
    await expect(
      sale(w, w.dress.id, [{ method: "STORE_CREDIT", amountCents: 11500 }]),
    ).rejects.toBeInstanceOf(CustomerRequiredError);
    expect(await testDb.sale.count()).toBe(0);
    expect(await onHand(w.dress.id)).toBe(50);
  });

  it("refuses to spend more than the balance and rolls the whole sale back", async () => {
    const w = await world();
    await giveCredit(w, w.ana.id, 1000);
    await expect(
      sale(w, w.dress.id, [{ method: "STORE_CREDIT", amountCents: 11500 }], w.ana.id),
    ).rejects.toBeInstanceOf(InsufficientCreditError);
    expect(await testDb.sale.count()).toBe(0);
    expect(await onHand(w.dress.id)).toBe(50);
    expect(await balanceOf(w.ana.id)).toBe(1000);
    // El número de ticket no se gastó
    await giveCredit(w, w.ana.id, 10500);
    const ok = await sale(
      w,
      w.dress.id,
      [{ method: "STORE_CREDIT", amountCents: 11500 }],
      w.ana.id,
    );
    expect(ok.number).toBe("T-000001");
    expect(await balanceOf(w.ana.id)).toBe(0);
  });

  it("never gives change out of credit", async () => {
    const w = await world();
    await giveCredit(w, w.ana.id, 20000);
    await expect(
      sale(w, w.dress.id, [{ method: "STORE_CREDIT", amountCents: 20000 }], w.ana.id),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await balanceOf(w.ana.id)).toBe(20000);
    expect(await testDb.sale.count()).toBe(0);
  });

  it("does not spend the same credit twice when two sales race for it", async () => {
    const w = await world();
    await giveCredit(w, w.ana.id, 11500);
    const attempts = await Promise.allSettled(
      [1, 2, 3].map(() =>
        sale(w, w.dress.id, [{ method: "STORE_CREDIT", amountCents: 11500 }], w.ana.id),
      ),
    );
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
    for (const attempt of attempts) {
      if (attempt.status === "rejected") {
        expect(attempt.reason).toBeInstanceOf(InsufficientCreditError);
      }
    }
    expect(await balanceOf(w.ana.id)).toBe(0);
    expect(await testDb.sale.count()).toBe(1);
    expect(await onHand(w.dress.id)).toBe(49);
    await expectLedgerMatchesCache();
  });

  it("does not charge twice when the same request is sent again", async () => {
    const w = await world();
    await giveCredit(w, w.ana.id, 20000);
    const id = requestId();
    const first = await sale(
      w,
      w.dress.id,
      [{ method: "STORE_CREDIT", amountCents: 11500 }],
      w.ana.id,
      id,
    );
    const again = await sale(
      w,
      w.dress.id,
      [{ method: "STORE_CREDIT", amountCents: 11500 }],
      w.ana.id,
      id,
    );
    expect(again.id).toBe(first.id);
    expect(again.replayed).toBe(true);
    expect(await balanceOf(w.ana.id)).toBe(8500);
  });

  it("restores the credit when the sale is voided", async () => {
    const w = await world();
    await giveCredit(w, w.ana.id, 11500);
    const result = await sale(
      w,
      w.dress.id,
      [{ method: "STORE_CREDIT", amountCents: 11500 }],
      w.ana.id,
    );
    expect(await balanceOf(w.ana.id)).toBe(0);

    await voidSale(w.manager, result.id, { reason: "Cobro equivocado" }, testDb);
    expect(await balanceOf(w.ana.id)).toBe(11500);
    const entries = await testDb.storeCreditEntry.findMany({
      where: { customerId: w.ana.id, refId: result.id },
      orderBy: { createdAt: "asc" },
    });
    expect(entries.map((e) => [e.amountCents, e.reason])).toEqual([
      [-11500, "USED_IN_SALE"],
      [11500, "SALE_VOID"],
    ]);
    expect(await onHand(w.dress.id)).toBe(50);
    await expect(
      voidSale(w.manager, result.id, { reason: "Otra vez" }, testDb),
    ).rejects.toBeInstanceOf(SaleStateError);
    expect(await balanceOf(w.ana.id)).toBe(11500);
    await expectLedgerMatchesCache();
  });

  it("pays the difference of an exchange with credit", async () => {
    const w = await world();
    const original = await sale(w, w.dress.id, [{ method: "CASH", amountCents: 11500 }], w.ana.id);
    const [item] = await testDb.saleItem.findMany({ where: { saleId: original.id } });
    await giveCredit(w, w.ana.id, 9000);
    const result = await processExchange(
      w.cashier,
      {
        clientRequestId: requestId(),
        saleId: original.id,
        items: [{ saleItemId: item!.id, quantity: 1, condition: "RESELLABLE" }],
        reason: "Talla incorrecta",
        newLines: [{ variantId: w.shirt.id, quantity: 1 }],
        payments: [{ method: "STORE_CREDIT", amountCents: 8500 }],
        customerId: w.ana.id,
      },
      testDb,
    );
    // 20000 de la prenda nueva − 11500 de lo devuelto = 8500 con crédito
    expect(result.exchange).toMatchObject({ totalCents: 20000, paidCents: 20000, changeCents: 0 });
    expect(await balanceOf(w.ana.id)).toBe(500);
    await expectLedgerMatchesCache();
    expect(await findStockDiscrepancies(testDb)).toEqual([]);
  });
});

describe("adjusting store credit by hand", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("adds credit with a reason and leaves it in the ledger and the audit log", async () => {
    const w = await world();
    const result = await adjustStoreCredit(
      w.manager,
      {
        requestId: requestId(),
        customerId: w.ana.id,
        direction: "ADD",
        amountCents: 5000,
        reason: "Cortesía por demora",
      },
      testDb,
    );
    expect(result).toEqual({ balanceCents: 5000, replayed: false });
    const [entry] = await testDb.storeCreditEntry.findMany({ where: { customerId: w.ana.id } });
    expect(entry).toMatchObject({
      amountCents: 5000,
      reason: "MANUAL",
      refType: "Adjustment",
      note: "Cortesía por demora",
      userId: w.manager.id,
    });
    const log = await testDb.auditLog.findFirstOrThrow({
      where: { action: "STORE_CREDIT_ADJUSTED" },
    });
    expect(log).toMatchObject({
      entityType: "Customer",
      entityId: w.ana.id,
      userId: w.manager.id,
      reason: "Cortesía por demora",
      before: { storeCreditCents: 0 },
      after: { storeCreditCents: 5000, amountCents: 5000 },
    });
  });

  it("subtracts credit but never below zero", async () => {
    const w = await world();
    await giveCredit(w, w.ana.id, 5000);
    const result = await adjustStoreCredit(
      w.owner,
      {
        requestId: requestId(),
        customerId: w.ana.id,
        direction: "SUBTRACT",
        amountCents: 2000,
        reason: "Error de captura",
      },
      testDb,
    );
    expect(result.balanceCents).toBe(3000);
    await expect(
      adjustStoreCredit(
        w.owner,
        {
          requestId: requestId(),
          customerId: w.ana.id,
          direction: "SUBTRACT",
          amountCents: 3001,
          reason: "Demasiado",
        },
        testDb,
      ),
    ).rejects.toBeInstanceOf(InsufficientCreditError);
    expect(await balanceOf(w.ana.id)).toBe(3000);
    await expectLedgerMatchesCache();
  });

  it("needs the permission, a reason and a whole positive amount", async () => {
    const w = await world();
    const base = {
      customerId: w.ana.id,
      direction: "ADD" as const,
      amountCents: 1000,
      reason: "Prueba",
    };
    for (const actor of [w.cashier, w.warehouse]) {
      await expect(
        adjustStoreCredit(actor, { ...base, requestId: requestId() }, testDb),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    for (const bad of [
      { amountCents: 0 },
      { amountCents: -5 },
      { amountCents: 10.5 },
      { reason: "ab" },
    ]) {
      await expect(
        adjustStoreCredit(w.manager, { ...base, ...bad, requestId: requestId() }, testDb),
      ).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(
      adjustStoreCredit(
        w.manager,
        { ...base, customerId: "no-existe", requestId: requestId() },
        testDb,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await testDb.storeCreditEntry.count()).toBe(0);
    expect(await testDb.auditLog.count({ where: { action: "STORE_CREDIT_ADJUSTED" } })).toBe(0);
  });

  it("does not adjust twice when the same request is sent several times at once", async () => {
    const w = await world();
    const id = requestId();
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        adjustStoreCredit(
          w.manager,
          {
            requestId: id,
            customerId: w.ana.id,
            direction: "ADD",
            amountCents: 4000,
            reason: "Cortesía",
          },
          testDb,
        ),
      ),
    );
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(results.every((r) => r.balanceCents === 4000)).toBe(true);
    expect(await testDb.storeCreditEntry.count()).toBe(1);
    expect(await testDb.auditLog.count({ where: { action: "STORE_CREDIT_ADJUSTED" } })).toBe(1);
  });
});

describe("store credit invariant", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("keeps every balance equal to its ledger through returns, sales, voids and adjustments", async () => {
    const w = await world();
    // Una venta en efectivo a Ana y una devolución a crédito
    const first = await sale(w, w.dress.id, [{ method: "CASH", amountCents: 11500 }], w.ana.id);
    const [item] = await testDb.saleItem.findMany({ where: { saleId: first.id } });
    await processReturn(
      w.cashier,
      {
        clientRequestId: requestId(),
        saleId: first.id,
        items: [{ saleItemId: item!.id, quantity: 1, condition: "RESELLABLE" }],
        reason: "No le gustó",
        refundMethod: "STORE_CREDIT",
      },
      testDb,
    );
    expect(await balanceOf(w.ana.id)).toBe(11500);

    // Gasta una parte, anula esa venta, ajusta a mano y gasta lo de Luis
    const spent = await sale(
      w,
      w.dress2.id,
      [{ method: "STORE_CREDIT", amountCents: 11500 }],
      w.ana.id,
    );
    await voidSale(w.manager, spent.id, { reason: "Se arrepintió" }, testDb);
    await giveCredit(w, w.luis.id, 20000);
    await sale(w, w.shirt.id, [{ method: "STORE_CREDIT", amountCents: 20000 }], w.luis.id);
    await adjustStoreCredit(
      w.manager,
      {
        requestId: requestId(),
        customerId: w.ana.id,
        direction: "SUBTRACT",
        amountCents: 1500,
        reason: "Ajuste",
      },
      testDb,
    );

    expect(await balanceOf(w.ana.id)).toBe(10000);
    expect(await balanceOf(w.luis.id)).toBe(0);
    await expectLedgerMatchesCache();
    expect(await findStockDiscrepancies(testDb)).toEqual([]);
  });
});

describe("customer ficha", () => {
  beforeEach(resetDatabase);
  afterAll(closeAll);

  it("shows the balance, every credit movement newest first and what the customer did", async () => {
    const w = await world();
    const first = await sale(w, w.dress.id, [{ method: "CASH", amountCents: 11500 }], w.ana.id);
    const [item] = await testDb.saleItem.findMany({ where: { saleId: first.id } });
    const returned = await processReturn(
      w.cashier,
      {
        clientRequestId: requestId(),
        saleId: first.id,
        items: [{ saleItemId: item!.id, quantity: 1, condition: "RESELLABLE" }],
        reason: "No le gustó",
        refundMethod: "STORE_CREDIT",
      },
      testDb,
    );
    const spent = await sale(
      w,
      w.dress2.id,
      [{ method: "STORE_CREDIT", amountCents: 11500 }],
      w.ana.id,
    );
    await adjustStoreCredit(
      w.manager,
      {
        requestId: requestId(),
        customerId: w.ana.id,
        direction: "ADD",
        amountCents: 2500,
        reason: "Cortesía",
      },
      testDb,
    );

    const ficha = await getCustomerFicha(w.ana.id);
    expect(ficha).toMatchObject({
      name: "Ana Pérez",
      phone: "9999-0000",
      storeCreditCents: 2500,
      archived: false,
    });
    expect(
      ficha?.movements.map((m) => [m.amountCents, m.reason, m.document?.label ?? null, m.note]),
    ).toEqual([
      [2500, "MANUAL", null, "Cortesía"],
      [-11500, "USED_IN_SALE", spent.number, null],
      [11500, "RETURN", returned.number, null],
    ]);
    expect(ficha?.movements[1]?.document?.href).toBe(`/ventas/${spent.id}`);
    expect(ficha?.movements[2]?.document?.href).toBe(`/imprimir/devolucion/${returned.id}`);
    expect(ficha?.sales.map((x) => x.number)).toEqual([spent.number, first.number]);
    expect(ficha?.returns.map((x) => x.number)).toEqual([returned.number]);
    expect(await getCustomerCreditCents(w.ana.id)).toBe(2500);
  });

  it("returns nothing for a customer that does not exist", async () => {
    await world();
    expect(await getCustomerFicha("no-existe")).toBeNull();
    expect(await getCustomerCreditCents("no-existe")).toBeNull();
  });
});
