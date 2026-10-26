import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { formatDocumentNumber, nextDocumentNumber, nextDocumentValue } from "@/lib/document-number";
import { InsufficientStockError } from "@/lib/errors";
import { findStockDiscrepancies } from "@/modules/inventory/reconcile";
import { recordMovement, type MovementInput } from "@/modules/inventory/service";

import { closeDatabase, resetDatabase, testDb } from "./helpers/db";

const ATTEMPTS = 20;
/** Las transacciones esperan su turno para una conexión del pool; con 20 a la vez hay que darles tiempo. */
const TX_OPTIONS = { maxWait: 30_000, timeout: 30_000 };

async function seed() {
  const user = await testDb.user.create({
    data: { name: "Almacén", username: "almacen", passwordHash: "x", role: "WAREHOUSE" },
  });
  const main = await testDb.location.create({
    data: { code: "MAIN", name: "Tienda principal", isDefault: true },
  });
  const other = await testDb.location.create({ data: { code: "BOD", name: "Bodega" } });
  const category = await testDb.category.create({ data: { name: "Mujer", slug: "mujer" } });
  const product = await testDb.product.create({
    data: { code: "CON1", name: "Blusa", categoryId: category.id, basePriceCents: 10000 },
  });
  const variant = await testDb.variant.create({
    data: { productId: product.id, sku: "CON1", barcode: "2000000000015" },
  });
  return { user, main, other, variantId: variant.id };
}

type World = Awaited<ReturnType<typeof seed>>;

const move = (w: World, overrides: Partial<MovementInput>): MovementInput => ({
  variantId: w.variantId,
  locationId: w.main.id,
  userId: w.user.id,
  type: "ADJUSTMENT_IN",
  quantity: 1,
  ...overrides,
});

const inOwnTransaction = (input: MovementInput) =>
  testDb.$transaction((tx) => recordMovement(tx, input), TX_OPTIONS);

async function onHand(w: World, locationId = w.main.id): Promise<number> {
  const level = await testDb.stockLevel.findUnique({
    where: { variantId_locationId: { variantId: w.variantId, locationId } },
  });
  return level?.onHand ?? 0;
}

describe("recordMovement bajo concurrencia", () => {
  beforeEach(resetDatabase);
  afterAll(closeDatabase);

  it("20 intentos simultáneos de sacar la última unidad: exactamente 1 éxito", async () => {
    const w = await seed();
    await inOwnTransaction(move(w, { type: "INITIAL", quantity: 1 }));

    const results = await Promise.allSettled(
      Array.from({ length: ATTEMPTS }, () =>
        inOwnTransaction(move(w, { type: "SALE_OUT", quantity: -1 })),
      ),
    );

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(failures).toHaveLength(ATTEMPTS - 1);
    for (const failure of failures) {
      expect(failure.reason).toBeInstanceOf(InsufficientStockError);
    }
    expect(await onHand(w)).toBe(0);
    expect(await testDb.stockMovement.count({ where: { type: "SALE_OUT" } })).toBe(1);
    expect(await findStockDiscrepancies(testDb)).toEqual([]);
  });

  it("con 5 unidades y 20 ventas simultáneas, entran exactamente 5", async () => {
    const w = await seed();
    await inOwnTransaction(move(w, { type: "INITIAL", quantity: 5 }));

    const results = await Promise.allSettled(
      Array.from({ length: ATTEMPTS }, () =>
        inOwnTransaction(move(w, { type: "SALE_OUT", quantity: -1 })),
      ),
    );

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);
    expect(await onHand(w)).toBe(0);
    expect(await findStockDiscrepancies(testDb)).toEqual([]);
  });

  it("20 primeras entradas simultáneas de una variante nueva: todas entran y hay una sola fila", async () => {
    const w = await seed();

    const results = await Promise.allSettled(
      Array.from({ length: ATTEMPTS }, () =>
        inOwnTransaction(move(w, { type: "ADJUSTMENT_IN", quantity: 1 })),
      ),
    );

    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(await onHand(w)).toBe(ATTEMPTS);
    expect(await testDb.stockLevel.count()).toBe(1);
    expect(await testDb.stockMovement.count()).toBe(ATTEMPTS);
    expect(await findStockDiscrepancies(testDb)).toEqual([]);
  });

  it("entradas y salidas mezcladas dejan la existencia exacta y el kardex cuadrado", async () => {
    const w = await seed();
    await inOwnTransaction(move(w, { type: "INITIAL", quantity: 10 }));

    const attempts = [
      ...Array.from({ length: 10 }, () => move(w, { type: "ADJUSTMENT_IN", quantity: 2 })),
      ...Array.from({ length: 10 }, () => move(w, { type: "SALE_OUT", quantity: -1 })),
    ];
    const results = await Promise.allSettled(attempts.map(inOwnTransaction));

    expect(results.every((r) => r.status === "fulfilled")).toBe(true); // siempre hay stock de sobra
    expect(await onHand(w)).toBe(10 + 20 - 10);
    expect(await findStockDiscrepancies(testDb)).toEqual([]);
  });

  it("dos compras simultáneas de la misma variante dan el mismo costo promedio que en fila", async () => {
    const w = await seed();
    await testDb.variant.update({ where: { id: w.variantId }, data: { avgCostCents: 1000 } });
    await inOwnTransaction(move(w, { type: "INITIAL", quantity: 10, unitCostCents: 1000 }));

    await Promise.all([
      inOwnTransaction(move(w, { type: "PURCHASE_IN", quantity: 10, unitCostCents: 1200 })),
      inOwnTransaction(move(w, { type: "PURCHASE_IN", quantity: 10, unitCostCents: 1400 })),
    ]);

    // En cualquier orden: (10×1000 + 10×1200) ÷ 20 = 1100; (20×1100 + 10×1400) ÷ 30 = 1200
    // (o 1200 y luego (20×1200 + 10×1200) ÷ 30 = 1200). El resultado es el mismo.
    const variant = await testDb.variant.findUniqueOrThrow({ where: { id: w.variantId } });
    expect(variant.avgCostCents).toBe(1200);
    expect(await onHand(w)).toBe(30);
  });

  it("el bloqueo es por ubicación: vender en una no afecta a la otra", async () => {
    const w = await seed();
    await inOwnTransaction(move(w, { type: "INITIAL", quantity: 1 }));
    await inOwnTransaction(move(w, { type: "INITIAL", quantity: 1, locationId: w.other.id }));

    const results = await Promise.allSettled([
      inOwnTransaction(move(w, { type: "SALE_OUT", quantity: -1 })),
      inOwnTransaction(move(w, { type: "SALE_OUT", quantity: -1, locationId: w.other.id })),
    ]);

    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(await onHand(w)).toBe(0);
    expect(await onHand(w, w.other.id)).toBe(0);
  });
});

describe("numeración de documentos", () => {
  beforeEach(resetDatabase);

  it("da formato con ceros a la izquierda", () => {
    expect(formatDocumentNumber("OC", 42)).toBe("OC-000042");
    expect(formatDocumentNumber("RC", 1234567)).toBe("RC-1234567");
    expect(formatDocumentNumber("T", 7, 3)).toBe("T-007");
  });

  it("empieza en 1 aunque no exista el contador, y sigue sin saltos", async () => {
    const numbers = await testDb.$transaction(async (tx) => [
      await nextDocumentNumber(tx, "PURCHASE_ORDER"),
      await nextDocumentNumber(tx, "PURCHASE_ORDER"),
      await nextDocumentNumber(tx, "GOODS_RECEIPT"),
    ]);
    expect(numbers).toEqual(["OC-000001", "OC-000002", "RC-000001"]);
  });

  it("continúa desde el contador existente", async () => {
    await testDb.documentCounter.create({ data: { key: "GOODS_RECEIPT", nextValue: 41 } });
    expect(await testDb.$transaction((tx) => nextDocumentNumber(tx, "GOODS_RECEIPT"))).toBe(
      "RC-000041",
    );
  });

  it("30 transacciones simultáneas reciben números distintos y consecutivos", async () => {
    const values = await Promise.all(
      Array.from({ length: 30 }, () =>
        testDb.$transaction((tx) => nextDocumentValue(tx, "PURCHASE_ORDER"), TX_OPTIONS),
      ),
    );
    expect([...values].sort((a, b) => a - b)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
  });

  it("si la transacción se revierte, el número no se pierde", async () => {
    await testDb.$transaction((tx) => nextDocumentValue(tx, "GOODS_RECEIPT"));
    await expect(
      testDb.$transaction(async (tx) => {
        await nextDocumentValue(tx, "GOODS_RECEIPT");
        throw new Error("revertir");
      }),
    ).rejects.toThrow("revertir");
    expect(await testDb.$transaction((tx) => nextDocumentValue(tx, "GOODS_RECEIPT"))).toBe(2);
  });
});
