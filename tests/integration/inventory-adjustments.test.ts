import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  ForbiddenError,
  InsufficientStockError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import type { Role } from "@/lib/permissions";
import { setSetting } from "@/lib/settings";
import { adjustStock } from "@/modules/inventory/adjustments";
import { findStockDiscrepancies } from "@/modules/inventory/reconcile";
import { recordMovement } from "@/modules/inventory/service";

import { closeDatabase, resetDatabase, testDb } from "./helpers/db";

type Actor = { id: string; role: Role };

async function world(onHand = 5) {
  const make = async (username: string, role: Role): Promise<Actor> => {
    const user = await testDb.user.create({
      data: { name: username, username, passwordHash: "x", role },
    });
    return { id: user.id, role };
  };
  const warehouse = await make("warehouse", "WAREHOUSE");
  const cashier = await make("cashier", "CASHIER");
  const location = await testDb.location.create({
    data: { code: "MAIN", name: "Tienda principal", isDefault: true },
  });
  const category = await testDb.category.create({ data: { name: "Mujer", slug: "mujer" } });
  const product = await testDb.product.create({
    data: { code: "AJU1", name: "Blusa", categoryId: category.id, basePriceCents: 10000 },
  });
  const variant = await testDb.variant.create({
    data: { productId: product.id, sku: "AJU1", barcode: "2000000000015", avgCostCents: 4200 },
  });
  if (onHand > 0) {
    await testDb.$transaction((tx) =>
      recordMovement(tx, {
        variantId: variant.id,
        locationId: location.id,
        userId: warehouse.id,
        type: "INITIAL",
        quantity: onHand,
      }),
    );
  }
  return { warehouse, cashier, location, variantId: variant.id };
}

const current = async (variantId: string) =>
  (await testDb.stockLevel.findFirst({ where: { variantId } }))?.onHand ?? 0;

describe("adjustStock", () => {
  beforeEach(resetDatabase);
  afterAll(closeDatabase);

  it("adds units with a reason, leaving kardex, stock and audit in step", async () => {
    const w = await world(5);
    const result = await adjustStock(
      w.warehouse,
      { variantId: w.variantId, mode: "in", quantity: 3, reason: "COUNT_ERROR" },
      testDb,
    );

    expect(result).toEqual({ delta: 3, onHand: 8 });
    expect(await current(w.variantId)).toBe(8);
    const movement = await testDb.stockMovement.findFirstOrThrow({
      where: { type: "ADJUSTMENT_IN" },
    });
    expect(movement).toMatchObject({
      quantity: 3,
      reason: "Error de conteo",
      userId: w.warehouse.id,
      unitCostCents: 4200, // el costo promedio de ese momento
    });
    const log = await testDb.auditLog.findFirstOrThrow({ where: { action: "STOCK_ADJUSTED" } });
    expect(log).toMatchObject({
      userId: w.warehouse.id,
      entityType: "Variant",
      entityId: w.variantId,
      before: { onHand: 5 },
      after: { onHand: 8 },
      reason: "Error de conteo",
    });
    expect(await findStockDiscrepancies(testDb)).toEqual([]);
  });

  it("removes units, with the free-text detail when the reason is Other", async () => {
    const w = await world(5);
    const result = await adjustStock(
      w.warehouse,
      {
        variantId: w.variantId,
        mode: "out",
        quantity: 2,
        reason: "OTHER",
        note: "Se cayó del exhibidor",
      },
      testDb,
    );
    expect(result).toEqual({ delta: -2, onHand: 3 });
    const movement = await testDb.stockMovement.findFirstOrThrow({
      where: { type: "ADJUSTMENT_OUT" },
    });
    expect(movement).toMatchObject({ quantity: -2, reason: "Otro: Se cayó del exhibidor" });
  });

  it("sets the real stock by computing the difference, in either direction", async () => {
    const w = await world(5);
    const set = (quantity: number) =>
      adjustStock(
        w.warehouse,
        { variantId: w.variantId, mode: "set", quantity, reason: "DAMAGE" },
        testDb,
      );

    expect(await set(9)).toEqual({ delta: 4, onHand: 9 });
    expect(await set(2)).toEqual({ delta: -7, onHand: 2 });
    expect(await set(0)).toEqual({ delta: -2, onHand: 0 });
    expect(await current(w.variantId)).toBe(0);
    const types = (await testDb.stockMovement.findMany({ orderBy: { createdAt: "asc" } })).map(
      (m) => m.type,
    );
    expect(types).toEqual(["INITIAL", "ADJUSTMENT_IN", "ADJUSTMENT_OUT", "ADJUSTMENT_OUT"]);
  });

  it("writes nothing when the stock already is the value given", async () => {
    const w = await world(5);
    const result = await adjustStock(
      w.warehouse,
      { variantId: w.variantId, mode: "set", quantity: 5, reason: "COUNT_ERROR" },
      testDb,
    );
    expect(result).toEqual({ delta: 0, onHand: 5 });
    expect(await testDb.stockMovement.count()).toBe(1); // solo el inicial
    expect(await testDb.auditLog.count()).toBe(0);
  });

  it("works on a variant that never had stock", async () => {
    const w = await world(0);
    await adjustStock(
      w.warehouse,
      { variantId: w.variantId, mode: "in", quantity: 4, reason: "GIFT" },
      testDb,
    );
    expect(await current(w.variantId)).toBe(4);
  });

  it("refuses to go below zero, unless negative stock is allowed", async () => {
    const w = await world(2);
    const remove = (quantity: number) =>
      adjustStock(
        w.warehouse,
        { variantId: w.variantId, mode: "out", quantity, reason: "THEFT" },
        testDb,
      );

    await expect(remove(3)).rejects.toBeInstanceOf(InsufficientStockError);
    expect(await current(w.variantId)).toBe(2);
    expect(await testDb.stockMovement.count()).toBe(1);
    expect(await testDb.auditLog.count()).toBe(0);

    await setSetting(testDb, "sales.allowNegativeStock", true);
    expect(await remove(3)).toEqual({ delta: -3, onHand: -1 });
  });

  it("requires a valid quantity and reason, and a detail for Other", async () => {
    const w = await world(5);
    const bad: object[] = [
      { variantId: w.variantId, mode: "in", quantity: 0, reason: "WASTE" },
      { variantId: w.variantId, mode: "in", quantity: 1.5, reason: "WASTE" },
      { variantId: w.variantId, mode: "in", quantity: 1 },
      { variantId: w.variantId, mode: "in", quantity: 1, reason: "OTHER" },
      { variantId: w.variantId, mode: "dar", quantity: 1, reason: "WASTE" },
    ];
    for (const input of bad) {
      await expect(
        adjustStock(w.warehouse, input, testDb),
        JSON.stringify(input),
      ).rejects.toBeInstanceOf(ValidationError);
    }
    expect(await testDb.stockMovement.count()).toBe(1);
  });

  it("is only for whoever can adjust stock, and reports unknown variants", async () => {
    const w = await world(5);
    await expect(
      adjustStock(
        w.cashier,
        { variantId: w.variantId, mode: "in", quantity: 1, reason: "WASTE" },
        testDb,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      adjustStock(
        w.warehouse,
        { variantId: "no-existe", mode: "in", quantity: 1, reason: "WASTE" },
        testDb,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await current(w.variantId)).toBe(5);
  });

  it("two simultaneous 'set to' adjustments never leave the stock out of step with the kardex", async () => {
    const w = await world(5);
    const results = await Promise.allSettled([
      adjustStock(
        w.warehouse,
        { variantId: w.variantId, mode: "set", quantity: 10, reason: "COUNT_ERROR" },
        testDb,
      ),
      adjustStock(
        w.warehouse,
        { variantId: w.variantId, mode: "set", quantity: 20, reason: "COUNT_ERROR" },
        testDb,
      ),
    ]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect([10, 20]).toContain(await current(w.variantId));
    expect(await findStockDiscrepancies(testDb)).toEqual([]);
  });
});
