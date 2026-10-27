import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { InsufficientStockError, NotFoundError, ValidationError } from "@/lib/errors";
import { setSetting } from "@/lib/settings";
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

describe("recordMovement: reglas de movimiento", () => {
  beforeEach(resetDatabase);

  const base = (w: Awaited<ReturnType<typeof seed>>) =>
    ({ variantId: w.variant.id, locationId: w.location.id, userId: w.user.id }) as const;

  it("rejects the wrong direction for each type, layaway reservations included", async () => {
    const w = await seed();
    const attempts = [
      { type: "SALE_OUT", quantity: 1 },
      { type: "ADJUSTMENT_OUT", quantity: 1 },
      { type: "ADJUSTMENT_IN", quantity: -1 },
      { type: "PURCHASE_IN", quantity: -1 },
      { type: "INITIAL", quantity: -1 },
      { type: "LAYAWAY_RESERVE", quantity: -1 },
      { type: "LAYAWAY_RELEASE", quantity: 1 },
    ] as const;
    for (const attempt of attempts) {
      await expect(
        testDb.$transaction((tx) => recordMovement(tx, { ...base(w), ...attempt })),
        attempt.type,
      ).rejects.toBeInstanceOf(ValidationError);
    }
    expect(await testDb.stockMovement.count()).toBe(0);
    expect(await testDb.stockLevel.count()).toBe(0);
  });

  it("reserves and releases without touching onHand; a sale only takes what is available", async () => {
    const w = await seed();
    const move = (
      type: "INITIAL" | "LAYAWAY_RESERVE" | "LAYAWAY_RELEASE" | "SALE_OUT" | "COUNT_ADJUSTMENT",
      quantity: number,
    ) => testDb.$transaction((tx) => recordMovement(tx, { ...base(w), type, quantity }));
    const level = () => testDb.stockLevel.findFirstOrThrow({ where: { variantId: w.variant.id } });

    await move("INITIAL", 5);
    await move("LAYAWAY_RESERVE", 3);
    expect(await level()).toMatchObject({ onHand: 5, reserved: 3 });

    // Solo quedan 2 disponibles: no se pueden reservar 3 más, ni liberar más de lo reservado
    await expect(move("LAYAWAY_RESERVE", 3)).rejects.toBeInstanceOf(InsufficientStockError);
    await expect(move("LAYAWAY_RELEASE", -4)).rejects.toBeInstanceOf(ValidationError);
    // Una venta tampoco puede entrar en lo reservado
    await expect(move("SALE_OUT", -3)).rejects.toBeInstanceOf(InsufficientStockError);
    await move("SALE_OUT", -2);
    expect(await level()).toMatchObject({ onHand: 3, reserved: 3 });

    // Un conteo físico refleja lo que de verdad hay, aunque quede por debajo de lo reservado
    await move("COUNT_ADJUSTMENT", -2);
    expect(await level()).toMatchObject({ onHand: 1, reserved: 3 });

    await move("LAYAWAY_RELEASE", -3);
    expect(await level()).toMatchObject({ onHand: 1, reserved: 0 });
    const kinds = await testDb.stockMovement.findMany({
      where: { type: { in: ["LAYAWAY_RESERVE", "LAYAWAY_RELEASE"] } },
      orderBy: { createdAt: "asc" },
    });
    expect(kinds.map((m) => [m.type, m.quantity])).toEqual([
      ["LAYAWAY_RESERVE", 3],
      ["LAYAWAY_RELEASE", -3],
    ]);
  });

  it("lets a count adjustment go either way", async () => {
    const w = await seed();
    await testDb.$transaction(async (tx) => {
      await recordMovement(tx, { ...base(w), type: "INITIAL", quantity: 5 });
      await recordMovement(tx, { ...base(w), type: "COUNT_ADJUSTMENT", quantity: -2 });
      await recordMovement(tx, { ...base(w), type: "COUNT_ADJUSTMENT", quantity: 1 });
    });
    expect(await onHand(w.variant.id, w.location.id)).toBe(4);
  });

  it("follows the negative-stock setting unless the caller overrides it", async () => {
    const w = await seed();
    const sell = (allowNegative?: boolean) =>
      testDb.$transaction((tx) =>
        recordMovement(tx, { ...base(w), type: "SALE_OUT", quantity: -1, allowNegative }),
      );

    await expect(sell()).rejects.toBeInstanceOf(InsufficientStockError); // por defecto: apagado

    await setSetting(testDb, "sales.allowNegativeStock", true);
    await sell();
    expect(await onHand(w.variant.id, w.location.id)).toBe(-1);

    await expect(sell(false)).rejects.toBeInstanceOf(InsufficientStockError); // la orden explícita manda
    expect(await onHand(w.variant.id, w.location.id)).toBe(-1);
  });

  it("records the current average cost when the caller gives none", async () => {
    const w = await seed();
    await testDb.variant.update({ where: { id: w.variant.id }, data: { avgCostCents: 3300 } });
    await testDb.$transaction(async (tx) => {
      await recordMovement(tx, { ...base(w), type: "ADJUSTMENT_IN", quantity: 2 });
      await recordMovement(tx, {
        ...base(w),
        type: "ADJUSTMENT_OUT",
        quantity: -1,
        unitCostCents: 100,
      });
    });
    const costs = (await testDb.stockMovement.findMany({ orderBy: { createdAt: "asc" } })).map(
      (m) => m.unitCostCents,
    );
    expect(costs).toEqual([3300, 100]);
  });

  it("fails clearly for an unknown variant", async () => {
    const w = await seed();
    await expect(
      testDb.$transaction((tx) =>
        recordMovement(tx, {
          ...base(w),
          variantId: "no-existe",
          type: "ADJUSTMENT_IN",
          quantity: 1,
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      testDb.$transaction((tx) =>
        recordMovement(tx, {
          ...base(w),
          variantId: "no-existe",
          type: "PURCHASE_IN",
          quantity: 1,
          unitCostCents: 5,
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("recordMovement: costo promedio en compras", () => {
  beforeEach(resetDatabase);

  const purchase = (w: Awaited<ReturnType<typeof seed>>, quantity: number, unitCostCents: number) =>
    testDb.$transaction((tx) =>
      recordMovement(tx, {
        variantId: w.variant.id,
        locationId: w.location.id,
        userId: w.user.id,
        type: "PURCHASE_IN",
        quantity,
        unitCostCents,
      }),
    );
  const avg = async (w: Awaited<ReturnType<typeof seed>>) =>
    (await testDb.variant.findUniqueOrThrow({ where: { id: w.variant.id } })).avgCostCents;

  it("takes the cost of the first purchase, then weights the following ones", async () => {
    const w = await seed();
    await purchase(w, 10, 1000);
    expect(await avg(w)).toBe(1000); // sin existencia previa: el costo de la entrada
    await purchase(w, 5, 1300);
    expect(await avg(w)).toBe(1100); // (10×1000 + 5×1300) ÷ 15
    expect(await onHand(w.variant.id, w.location.id)).toBe(15);
  });

  it("receiving 100 garments updates stock, kardex and average cost with concrete numbers", async () => {
    const w = await seed();
    await testDb.variant.update({ where: { id: w.variant.id }, data: { avgCostCents: 4000 } });
    await testDb.$transaction((tx) =>
      recordMovement(tx, {
        variantId: w.variant.id,
        locationId: w.location.id,
        userId: w.user.id,
        type: "INITIAL",
        quantity: 100,
        unitCostCents: 4000,
      }),
    );

    await purchase(w, 100, 5000);

    expect(await onHand(w.variant.id, w.location.id)).toBe(200);
    expect(await avg(w)).toBe(4500); // (100×4000 + 100×5000) ÷ 200
    const last = await testDb.stockMovement.findFirstOrThrow({
      where: { type: "PURCHASE_IN" },
    });
    expect(last).toMatchObject({ quantity: 100, unitCostCents: 5000 });
  });

  it("weights by the stock of every location", async () => {
    const w = await seed();
    const other = await testDb.location.create({ data: { code: "BOD", name: "Bodega" } });
    await testDb.variant.update({ where: { id: w.variant.id }, data: { avgCostCents: 1000 } });
    await testDb.$transaction(async (tx) => {
      await recordMovement(tx, {
        variantId: w.variant.id,
        locationId: w.location.id,
        userId: w.user.id,
        type: "INITIAL",
        quantity: 6,
        unitCostCents: 1000,
      });
      await recordMovement(tx, {
        variantId: w.variant.id,
        locationId: other.id,
        userId: w.user.id,
        type: "INITIAL",
        quantity: 4,
        unitCostCents: 1000,
      });
    });
    await purchase(w, 10, 2000);
    expect(await avg(w)).toBe(1500); // (10×1000 + 10×2000) ÷ 20
  });

  it("restarts from the new cost when the stock was negative or zero", async () => {
    const w = await seed();
    await testDb.variant.update({ where: { id: w.variant.id }, data: { avgCostCents: 999 } });
    await testDb.$transaction((tx) =>
      recordMovement(tx, {
        variantId: w.variant.id,
        locationId: w.location.id,
        userId: w.user.id,
        type: "SALE_OUT",
        quantity: -2,
        allowNegative: true,
      }),
    );
    await purchase(w, 5, 1234);
    expect(await avg(w)).toBe(1234);
  });

  it("does not touch the average cost for other movement types", async () => {
    const w = await seed();
    await testDb.variant.update({ where: { id: w.variant.id }, data: { avgCostCents: 777 } });
    await testDb.$transaction((tx) =>
      recordMovement(tx, {
        variantId: w.variant.id,
        locationId: w.location.id,
        userId: w.user.id,
        type: "ADJUSTMENT_IN",
        quantity: 3,
        unitCostCents: 50,
      }),
    );
    expect(await avg(w)).toBe(777);
  });
});
