import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  CountInProgressError,
  CountStateError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import type { Role } from "@/lib/permissions";
import {
  applyCount,
  cancelCount,
  openCount,
  reopenCount,
  scanCount,
  setCountedQty,
  submitCountForReview,
} from "@/modules/inventory/counts";
import { getCountSummary, listCountItems, listCounts } from "@/modules/inventory/count-queries";
import { findStockDiscrepancies } from "@/modules/inventory/reconcile";
import { recordMovement } from "@/modules/inventory/service";

import { closeDatabase, resetDatabase, testDb } from "./helpers/db";

type Actor = { id: string; role: Role };

async function world() {
  const make = async (username: string, role: Role): Promise<Actor> => {
    const user = await testDb.user.create({
      data: { name: username, username, passwordHash: "x", role },
    });
    return { id: user.id, role };
  };
  const owner = await make("owner", "OWNER");
  const manager = await make("manager", "MANAGER");
  const warehouse = await make("warehouse", "WAREHOUSE");
  const cashier = await make("cashier", "CASHIER");
  const location = await testDb.location.create({
    data: { code: "MAIN", name: "Tienda principal", isDefault: true },
  });
  const women = await testDb.category.create({ data: { name: "Mujer", slug: "mujer" } });
  const dresses = await testDb.category.create({
    data: { name: "Vestidos", slug: "mujer-vestidos", parentId: women.id },
  });
  const men = await testDb.category.create({ data: { name: "Hombre", slug: "hombre" } });

  const product = (code: string, name: string, categoryId: string) =>
    testDb.product.create({ data: { code, name, categoryId, basePriceCents: 10000 } });
  const [sizeS, sizeM, sizeX] = await Promise.all(
    ["S", "M", "X"].map((name, index) =>
      testDb.size.create({ data: { name, sortOrder: index + 1 } }),
    ),
  );
  const variant = (
    productId: string,
    sku: string,
    barcode: string,
    sizeId: string | null = null,
    avgCostCents = 4000,
  ) => testDb.variant.create({ data: { productId, sku, barcode, sizeId, avgCostCents } });
  const stock = (variantId: string, quantity: number) =>
    testDb.$transaction((tx) =>
      recordMovement(tx, {
        variantId,
        locationId: location.id,
        userId: owner.id,
        type: "INITIAL",
        quantity,
      }),
    );

  const dress = await product("VES1", "Vestido", dresses.id);
  const blouse = await product("BLU1", "Blusa", women.id);
  const shirt = await product("CAM1", "Camisa", men.id);
  const retired = await product("OLD1", "Vieja", women.id);
  await testDb.product.update({ where: { id: retired.id }, data: { archivedAt: new Date() } });

  const v1 = await variant(dress.id, "VES1-S", "7001", sizeS!.id);
  const v2 = await variant(dress.id, "VES1-M", "7002", sizeM!.id);
  const v3 = await variant(blouse.id, "BLU1", "7003");
  const v4 = await variant(shirt.id, "CAM1", "7004");
  const v5 = await variant(shirt.id, "CAM1-X", "7005", sizeX!.id);
  await variant(retired.id, "OLD1", "7006");
  await testDb.variant.update({ where: { id: v5.id }, data: { archivedAt: new Date() } });

  await stock(v1.id, 10);
  await stock(v2.id, 5);
  await stock(v3.id, 8);
  await stock(v4.id, 3);

  return {
    owner,
    manager,
    warehouse,
    cashier,
    location,
    women,
    dresses,
    men,
    v1,
    v2,
    v3,
    v4,
    v5,
    stock,
  };
}

type World = Awaited<ReturnType<typeof world>>;

const onHand = async (variantId: string) =>
  (await testDb.stockLevel.findFirst({ where: { variantId } }))?.onHand ?? 0;

/** Cuenta todo exactamente como dice el sistema, salvo lo que se indique. */
async function countLike(w: World, countId: string, counted: Record<string, number>) {
  const items = await testDb.stockCountItem.findMany({ where: { stockCountId: countId } });
  for (const item of items) {
    const quantity = counted[item.variantId] ?? item.expectedQty;
    await setCountedQty(w.warehouse, item.id, quantity, testDb);
  }
}

describe("openCount", () => {
  beforeEach(resetDatabase);
  afterAll(closeDatabase);

  it("freezes what the system says for every active variant", async () => {
    const w = await world();
    const { id, items } = await openCount(w.warehouse, { scope: "ALL" }, testDb);
    expect(items).toBe(4); // sin la archivada ni la de un producto archivado
    const rows = await testDb.stockCountItem.findMany({
      where: { stockCountId: id },
      orderBy: { variant: { sku: "asc" } },
      include: { variant: true },
    });
    expect(rows.map((r) => [r.variant.sku, r.expectedQty, r.countedQty])).toEqual([
      ["BLU1", 8, 0],
      ["CAM1", 3, 0],
      ["VES1-M", 5, 0],
      ["VES1-S", 10, 0],
    ]);
    const count = await testDb.stockCount.findUniqueOrThrow({ where: { id } });
    expect(count).toMatchObject({ status: "OPEN", scope: "ALL", startedById: w.warehouse.id });
  });

  it("can be limited to a category and its subcategories", async () => {
    const w = await world();
    const women = await openCount(
      w.warehouse,
      { scope: "CATEGORY", categoryId: w.women.id },
      testDb,
    );
    expect(women.items).toBe(3); // Mujer incluye Vestidos
    await cancelCount(w.warehouse, women.id, testDb);
    const dresses = await openCount(
      w.warehouse,
      { scope: "CATEGORY", categoryId: w.dresses.id },
      testDb,
    );
    expect(dresses.items).toBe(2);
    const count = await testDb.stockCount.findUniqueOrThrow({ where: { id: dresses.id } });
    expect(count).toMatchObject({ scope: "CATEGORY", scopeRef: w.dresses.id });
  });

  it("allows one count at a time, until it is cancelled or applied", async () => {
    const w = await world();
    const first = await openCount(w.warehouse, { scope: "ALL" }, testDb);
    await expect(openCount(w.warehouse, { scope: "ALL" }, testDb)).rejects.toBeInstanceOf(
      CountInProgressError,
    );
    await submitCountForReview(w.warehouse, first.id, testDb);
    await expect(openCount(w.warehouse, { scope: "ALL" }, testDb)).rejects.toBeInstanceOf(
      CountInProgressError,
    );
    await cancelCount(w.warehouse, first.id, testDb);
    await expect(openCount(w.warehouse, { scope: "ALL" }, testDb)).resolves.toBeDefined();
  });

  it("two simultaneous openings leave exactly one count", async () => {
    const w = await world();
    const results = await Promise.allSettled([
      openCount(w.warehouse, { scope: "ALL" }, testDb),
      openCount(w.warehouse, { scope: "ALL" }, testDb),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await testDb.stockCount.count()).toBe(1);
  });

  it("rejects empty scopes, unknown categories and bad input, and the cashier", async () => {
    const w = await world();
    const empty = await testDb.category.create({ data: { name: "Vacía", slug: "vacia" } });
    await expect(
      openCount(w.warehouse, { scope: "CATEGORY", categoryId: empty.id }, testDb),
    ).rejects.toBeInstanceOf(ValidationError);
    for (const input of [
      { scope: "CATEGORY", categoryId: "no-existe" },
      { scope: "CATEGORY" },
      { scope: "ZONE" },
      {},
    ]) {
      await expect(
        openCount(w.warehouse, input, testDb),
        JSON.stringify(input),
      ).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(openCount(w.cashier, { scope: "ALL" }, testDb)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(await testDb.stockCount.count()).toBe(0);
  });
});

describe("counting", () => {
  beforeEach(resetDatabase);

  it("scans by barcode or code, one unit at a time, with the running total", async () => {
    const w = await world();
    const { id } = await openCount(w.warehouse, { scope: "ALL" }, testDb);

    const first = await scanCount(w.warehouse, id, "7001", 1, testDb);
    expect(first).toMatchObject({
      found: true,
      item: {
        productName: "Vestido",
        sku: "VES1-S",
        expectedQty: 10,
        countedQty: 1,
        becameCounted: true,
      },
    });
    const second = await scanCount(w.warehouse, id, "ves1-s", 1, testDb); // por código, sin importar mayúsculas
    expect(second).toMatchObject({ found: true, item: { countedQty: 2, becameCounted: false } });
    expect(await scanCount(w.warehouse, id, "  7001  ", 1, testDb)).toMatchObject({
      item: { countedQty: 3 },
    });
  });

  it("undoes a scan without going below zero", async () => {
    const w = await world();
    const { id } = await openCount(w.warehouse, { scope: "ALL" }, testDb);
    await scanCount(w.warehouse, id, "7002", 1, testDb);
    expect(await scanCount(w.warehouse, id, "7002", -1, testDb)).toMatchObject({
      item: { countedQty: 0 },
    });
    expect(await scanCount(w.warehouse, id, "7002", -1, testDb)).toMatchObject({
      item: { countedQty: 0 },
    });
  });

  it("reports codes that are unknown, archived or outside the scope", async () => {
    const w = await world();
    const { id } = await openCount(
      w.warehouse,
      { scope: "CATEGORY", categoryId: w.dresses.id },
      testDb,
    );
    for (const code of ["9999", "7003", "7005", "7006", "", "   "]) {
      expect(await scanCount(w.warehouse, id, code, 1, testDb), code).toEqual({ found: false });
    }
    expect(await scanCount(w.warehouse, id, "7001", 0, testDb)).toEqual({ found: false });
  });

  it("two simultaneous scans of the same garment count both", async () => {
    const w = await world();
    const { id } = await openCount(w.warehouse, { scope: "ALL" }, testDb);
    await Promise.all(
      Array.from({ length: 10 }, () => scanCount(w.warehouse, id, "7001", 1, testDb)),
    );
    const item = await testDb.stockCountItem.findFirstOrThrow({
      where: { stockCountId: id, variantId: w.v1.id },
    });
    expect(item.countedQty).toBe(10);
  });

  it("sets a quantity by hand, only while counting", async () => {
    const w = await world();
    const { id } = await openCount(w.warehouse, { scope: "ALL" }, testDb);
    const item = await testDb.stockCountItem.findFirstOrThrow({
      where: { stockCountId: id, variantId: w.v3.id },
    });
    await setCountedQty(w.warehouse, item.id, 6, testDb);
    expect(
      (await testDb.stockCountItem.findUniqueOrThrow({ where: { id: item.id } })).countedQty,
    ).toBe(6);

    for (const bad of [-1, 1.5, Number.NaN, 1_000_001]) {
      await expect(
        setCountedQty(w.warehouse, item.id, bad, testDb),
        String(bad),
      ).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(setCountedQty(w.warehouse, "no-existe", 1, testDb)).rejects.toBeInstanceOf(
      NotFoundError,
    );

    await submitCountForReview(w.warehouse, id, testDb);
    await expect(setCountedQty(w.warehouse, item.id, 7, testDb)).rejects.toBeInstanceOf(
      CountStateError,
    );
    await expect(scanCount(w.warehouse, id, "7003", 1, testDb)).rejects.toBeInstanceOf(
      CountStateError,
    );
    await reopenCount(w.warehouse, id, testDb);
    await setCountedQty(w.warehouse, item.id, 7, testDb);
  });

  it("moves between states only in the allowed ways", async () => {
    const w = await world();
    const { id } = await openCount(w.warehouse, { scope: "ALL" }, testDb);
    await expect(reopenCount(w.warehouse, id, testDb)).rejects.toBeInstanceOf(CountStateError);
    await submitCountForReview(w.warehouse, id, testDb);
    await expect(submitCountForReview(w.warehouse, id, testDb)).rejects.toBeInstanceOf(
      CountStateError,
    );
    await cancelCount(w.warehouse, id, testDb);
    await expect(cancelCount(w.warehouse, id, testDb)).rejects.toBeInstanceOf(CountStateError);
    await expect(submitCountForReview(w.warehouse, "no-existe", testDb)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect((await testDb.stockCount.findUniqueOrThrow({ where: { id } })).status).toBe("CANCELLED");
  });
});

describe("applyCount", () => {
  beforeEach(resetDatabase);

  it("3 differences generate exactly 3 COUNT_ADJUSTMENT and leave the stock equal to what was counted", async () => {
    const w = await world();
    const { id } = await openCount(w.warehouse, { scope: "ALL" }, testDb);
    // Sistema: S 10, M 5, blusa 8, camisa 3. Se cuenta: S 9 (−1), M 5 (=), blusa 11 (+3), camisa 0 (−3)
    await countLike(w, id, { [w.v1.id]: 9, [w.v3.id]: 11, [w.v4.id]: 0 });
    await submitCountForReview(w.warehouse, id, testDb);

    const result = await applyCount(w.manager, id, testDb);

    expect(result).toEqual({ adjustments: 3, units: 7 });
    const movements = await testDb.stockMovement.findMany({ where: { type: "COUNT_ADJUSTMENT" } });
    expect(movements).toHaveLength(3);
    expect(movements.map((m) => m.quantity).sort((a, b) => a - b)).toEqual([-3, -1, 3]);
    expect(
      movements.every(
        (m) => m.refType === "StockCount" && m.refId === id && m.reason === "Conteo físico",
      ),
    ).toBe(true);
    expect(movements.every((m) => m.userId === w.manager.id)).toBe(true);
    expect(await onHand(w.v1.id)).toBe(9);
    expect(await onHand(w.v2.id)).toBe(5);
    expect(await onHand(w.v3.id)).toBe(11);
    expect(await onHand(w.v4.id)).toBe(0);
    expect(await findStockDiscrepancies(testDb)).toEqual([]);

    const count = await testDb.stockCount.findUniqueOrThrow({ where: { id } });
    expect(count).toMatchObject({ status: "APPLIED", approvedById: w.manager.id });
    expect(count.appliedAt).not.toBeNull();
    const log = await testDb.auditLog.findFirstOrThrow({ where: { entityType: "StockCount" } });
    expect(log).toMatchObject({ action: "STOCK_ADJUSTED", userId: w.manager.id });
    expect(log.after).toEqual({ adjustments: 3, units: 7 });
  });

  it("counts what was not scanned as zero", async () => {
    const w = await world();
    const { id } = await openCount(w.warehouse, { scope: "ALL" }, testDb);
    await scanCount(w.warehouse, id, "7001", 1, testDb); // solo se escanea una prenda
    await submitCountForReview(w.warehouse, id, testDb);
    await applyCount(w.owner, id, testDb);
    expect(await onHand(w.v1.id)).toBe(1);
    expect(await onHand(w.v2.id)).toBe(0);
    expect(await onHand(w.v3.id)).toBe(0);
  });

  it("writes nothing when everything matches", async () => {
    const w = await world();
    const { id } = await openCount(w.warehouse, { scope: "ALL" }, testDb);
    await countLike(w, id, {});
    await submitCountForReview(w.warehouse, id, testDb);
    expect(await applyCount(w.owner, id, testDb)).toEqual({ adjustments: 0, units: 0 });
    expect(await testDb.stockMovement.count({ where: { type: "COUNT_ADJUSTMENT" } })).toBe(0);
    expect((await testDb.stockCount.findUniqueOrThrow({ where: { id } })).status).toBe("APPLIED");
  });

  it("adjusts against what there is now, so sales made while counting are not undone", async () => {
    const w = await world();
    const { id } = await openCount(w.warehouse, { scope: "ALL" }, testDb);
    // Mientras se cuenta se vende 1 de la blusa (sistema 8 → 7)
    await testDb.$transaction((tx) =>
      recordMovement(tx, {
        variantId: w.v3.id,
        locationId: w.location.id,
        userId: w.owner.id,
        type: "SALE_OUT",
        quantity: -1,
      }),
    );
    await countLike(w, id, { [w.v3.id]: 7, [w.v1.id]: 10 });
    await submitCountForReview(w.warehouse, id, testDb);

    const result = await applyCount(w.owner, id, testDb);

    expect(result.adjustments).toBe(0); // 7 contadas = 7 que hay ahora
    expect(await onHand(w.v3.id)).toBe(7);
  });

  it("only applies counts under review, once, and only for managers and owners", async () => {
    const w = await world();
    const { id } = await openCount(w.warehouse, { scope: "ALL" }, testDb);
    await expect(applyCount(w.manager, id, testDb)).rejects.toBeInstanceOf(CountStateError); // todavía se cuenta
    await submitCountForReview(w.warehouse, id, testDb);
    await expect(applyCount(w.warehouse, id, testDb)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(applyCount(w.cashier, id, testDb)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(applyCount(w.manager, "no-existe", testDb)).rejects.toBeInstanceOf(NotFoundError);
    await applyCount(w.manager, id, testDb);
    await expect(applyCount(w.manager, id, testDb)).rejects.toBeInstanceOf(CountStateError);
  });

  it("two simultaneous applications produce one set of adjustments", async () => {
    const w = await world();
    const { id } = await openCount(w.warehouse, { scope: "ALL" }, testDb);
    await countLike(w, id, { [w.v1.id]: 7 });
    await submitCountForReview(w.warehouse, id, testDb);

    const results = await Promise.allSettled([
      applyCount(w.manager, id, testDb),
      applyCount(w.owner, id, testDb),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await testDb.stockMovement.count({ where: { type: "COUNT_ADJUSTMENT" } })).toBe(1);
    expect(await onHand(w.v1.id)).toBe(7);
    expect(await findStockDiscrepancies(testDb)).toEqual([]);
  });

  it("a cancelled count changes nothing", async () => {
    const w = await world();
    const { id } = await openCount(w.warehouse, { scope: "ALL" }, testDb);
    await countLike(w, id, { [w.v1.id]: 0 });
    await cancelCount(w.warehouse, id, testDb);
    await expect(applyCount(w.owner, id, testDb)).rejects.toBeInstanceOf(CountStateError);
    expect(await onHand(w.v1.id)).toBe(10);
    expect(await testDb.stockMovement.count({ where: { type: "COUNT_ADJUSTMENT" } })).toBe(0);
  });
});

describe("count queries", () => {
  beforeEach(resetDatabase);

  it("summarizes differences in units and in value, hiding the value when asked", async () => {
    const w = await world();
    const { id } = await openCount(
      w.warehouse,
      { scope: "CATEGORY", categoryId: w.women.id },
      testDb,
    );
    await countLike(w, id, { [w.v1.id]: 9, [w.v3.id]: 11 }); // −1 y +3, a L 40,00 cada una
    const summary = (await getCountSummary(id, { includeCost: true }, testDb))!;
    expect(summary).toMatchObject({
      status: "OPEN",
      scope: "CATEGORY",
      scopeName: "Mujer",
      startedByName: "warehouse",
      approvedByName: null,
      items: 3,
      unitsExpected: 23,
      unitsCounted: 25,
      differences: 2,
      netUnits: 2,
      valueCents: 2 * 4000,
    });
    expect((await getCountSummary(id, { includeCost: false }, testDb))!.valueCents).toBeNull();
    expect(await getCountSummary("no-existe", { includeCost: true }, testDb)).toBeNull();
  });

  it("lists items with the current stock, filtered by differences and text", async () => {
    const w = await world();
    const { id } = await openCount(w.warehouse, { scope: "ALL" }, testDb);
    await countLike(w, id, { [w.v1.id]: 9 });
    await testDb.$transaction((tx) =>
      recordMovement(tx, {
        variantId: w.v2.id,
        locationId: w.location.id,
        userId: w.owner.id,
        type: "SALE_OUT",
        quantity: -2,
      }),
    );

    const all = await listCountItems(id, { includeCost: true }, testDb);
    expect(all.total).toBe(4);
    expect(all.rows.map((r) => r.productName)).toEqual(["Blusa", "Camisa", "Vestido", "Vestido"]);

    const differences = await listCountItems(
      id,
      { differencesOnly: true, includeCost: true },
      testDb,
    );
    expect(
      differences.rows.map((r) => [
        r.sku,
        r.expectedQty,
        r.countedQty,
        r.difference,
        r.currentQty,
        r.valueCents,
      ]),
    ).toEqual([["VES1-S", 10, 9, -1, 10, -4000]]);

    const byText = await listCountItems(id, { q: "ves1-m", includeCost: false }, testDb);
    expect(byText.rows).toHaveLength(1);
    expect(byText.rows[0]).toMatchObject({ sku: "VES1-M", currentQty: 3, valueCents: null });
    expect((await listCountItems(id, { q: "7003", includeCost: false }, testDb)).rows[0]?.sku).toBe(
      "BLU1",
    );
  });

  it("lists counts newest first with their progress", async () => {
    const w = await world();
    const first = await openCount(w.warehouse, { scope: "ALL" }, testDb);
    await cancelCount(w.warehouse, first.id, testDb);
    const second = await openCount(
      w.warehouse,
      { scope: "CATEGORY", categoryId: w.dresses.id },
      testDb,
    );
    await scanCount(w.warehouse, second.id, "7001", 1, testDb);

    const counts = await listCounts(testDb);
    expect(counts.map((c) => c.id)).toEqual([second.id, first.id]);
    expect(counts[0]).toMatchObject({
      status: "OPEN",
      scopeName: "Vestidos",
      items: 2,
      counted: 1,
      differences: 2,
    });
    expect(counts[1]).toMatchObject({ status: "CANCELLED", scope: "ALL", scopeName: "" });
  });
});
