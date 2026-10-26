import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { InsufficientStockError, NotFoundError, ValidationError } from "@/lib/errors";
import { getDefaultLocationId, recordMovement } from "@/modules/inventory/service";

import { closeDatabase, resetDatabase, testDb } from "./helpers/db";

async function seed() {
  const user = await testDb.user.create({
    data: { name: "Almacén", username: "almacen", passwordHash: "x", role: "WAREHOUSE" },
  });
  const location = await testDb.location.create({
    data: { code: "MAIN", name: "Tienda principal", isDefault: true },
  });
  const category = await testDb.category.create({ data: { name: "Mujer", slug: "mujer" } });
  const product = await testDb.product.create({
    data: { code: "INV1", name: "Blusa", categoryId: category.id, basePriceCents: 10000 },
  });
  const variant = await testDb.variant.create({
    data: { productId: product.id, sku: "INV1", barcode: "2000000000015" },
  });
  return { user, location, variant };
}

async function onHand(variantId: string, locationId: string): Promise<number> {
  const level = await testDb.stockLevel.findUnique({
    where: { variantId_locationId: { variantId, locationId } },
  });
  return level?.onHand ?? 0;
}

describe("recordMovement", () => {
  beforeEach(resetDatabase);
  afterAll(closeDatabase);

  it("writes the kardex entry and the running total in the same call", async () => {
    const { user, location, variant } = await seed();
    const base = { variantId: variant.id, locationId: location.id, userId: user.id } as const;

    await testDb.$transaction(async (tx) => {
      await recordMovement(tx, { ...base, type: "INITIAL", quantity: 10, unitCostCents: 4000 });
      await recordMovement(tx, { ...base, type: "SALE_OUT", quantity: -3 });
    });

    expect(await onHand(variant.id, location.id)).toBe(7);
    const movements = await testDb.stockMovement.findMany({ orderBy: { createdAt: "asc" } });
    expect(movements.map((m) => [m.type, m.quantity, m.unitCostCents])).toEqual([
      ["INITIAL", 10, 4000],
      ["SALE_OUT", -3, 0],
    ]);
  });

  it("refuses to go below zero and leaves nothing behind", async () => {
    const { user, location, variant } = await seed();
    const base = { variantId: variant.id, locationId: location.id, userId: user.id } as const;
    await testDb.$transaction((tx) =>
      recordMovement(tx, { ...base, type: "INITIAL", quantity: 2 }),
    );

    await expect(
      testDb.$transaction((tx) => recordMovement(tx, { ...base, type: "SALE_OUT", quantity: -3 })),
    ).rejects.toBeInstanceOf(InsufficientStockError);

    expect(await onHand(variant.id, location.id)).toBe(2);
    expect(await testDb.stockMovement.count()).toBe(1);
  });

  it("allows negative stock only when the caller says the setting is on", async () => {
    const { user, location, variant } = await seed();
    await testDb.$transaction((tx) =>
      recordMovement(tx, {
        variantId: variant.id,
        locationId: location.id,
        userId: user.id,
        type: "SALE_OUT",
        quantity: -1,
        allowNegative: true,
      }),
    );
    expect(await onHand(variant.id, location.id)).toBe(-1);
  });

  it("rejects zero and fractional quantities", async () => {
    const { user, location, variant } = await seed();
    const base = {
      variantId: variant.id,
      locationId: location.id,
      userId: user.id,
      type: "ADJUSTMENT_IN",
    } as const;
    for (const quantity of [0, 1.5, Number.NaN]) {
      await expect(
        testDb.$transaction((tx) => recordMovement(tx, { ...base, quantity })),
        String(quantity),
      ).rejects.toBeInstanceOf(ValidationError);
    }
    expect(await testDb.stockMovement.count()).toBe(0);
  });

  it("finds the default location, or fails clearly", async () => {
    await expect(getDefaultLocationId(testDb)).rejects.toBeInstanceOf(NotFoundError);
    const { location } = await seed();
    expect(await getDefaultLocationId(testDb)).toBe(location.id);
  });
});
