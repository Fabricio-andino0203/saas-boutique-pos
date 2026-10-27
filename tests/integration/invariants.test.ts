import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { findStockDiscrepancies } from "@/modules/inventory/reconcile";

import { closeDatabase, resetDatabase, testDb } from "./helpers/db";

class RollbackSignal extends Error {}

type Tx = Parameters<Parameters<typeof testDb.$transaction>[0]>[0];

async function createStockFixture(tx: Tx, options: { withLevel: boolean }) {
  const user = await tx.user.create({
    data: { name: "Almacén", username: "warehouse-inv", passwordHash: "x", role: "WAREHOUSE" },
  });
  const location = await tx.location.create({ data: { name: "Tienda", code: "INV-MAIN" } });
  const category = await tx.category.create({ data: { name: "Vestidos", slug: "vestidos-inv" } });
  const product = await tx.product.create({
    data: { code: "INV-P1", name: "Vestido", categoryId: category.id, basePriceCents: 1000 },
  });
  const variant = await tx.variant.create({
    data: { productId: product.id, sku: "INV-P1-U", barcode: "INV-0000000001" },
  });
  await tx.stockMovement.create({
    data: {
      variantId: variant.id,
      locationId: location.id,
      type: "ADJUSTMENT_IN",
      quantity: 5,
      reason: "Conteo inicial de prueba",
      userId: user.id,
    },
  });
  if (options.withLevel) {
    await tx.stockLevel.create({
      data: { variantId: variant.id, locationId: location.id, onHand: 5 },
    });
  }
  return { variantId: variant.id, locationId: location.id };
}

describe("invariante 1: Σ StockMovement = StockLevel.onHand", () => {
  beforeEach(resetDatabase);
  afterAll(closeDatabase);

  it("reports nothing on an empty database", async () => {
    expect(await findStockDiscrepancies(testDb)).toEqual([]);
  });

  it("reports a movement without its StockLevel, and nothing after rollback", async () => {
    await expect(
      testDb.$transaction(async (tx) => {
        const ids = await createStockFixture(tx, { withLevel: false });
        expect(await findStockDiscrepancies(tx)).toEqual([{ ...ids, movementSum: 5, onHand: 0 }]);
        throw new RollbackSignal();
      }),
    ).rejects.toBeInstanceOf(RollbackSignal);
    expect(await findStockDiscrepancies(testDb)).toEqual([]);
  });

  it("reports nothing when the StockLevel matches the movements", async () => {
    await testDb.$transaction(async (tx) => {
      await createStockFixture(tx, { withLevel: true });
      expect(await findStockDiscrepancies(tx)).toEqual([]);
    });
  });
});

// Las invariantes de la Fase 3 (pagos, correlativos, efectivo esperado, anulaciones) se comprueban en
// `invariants-sales.test.ts` tras 200 operaciones aleatorias.
describe("invariantes pendientes de fases posteriores", () => {
  it.todo("Σ ReturnItem.quantity ≤ SaleItem.quantity por línea (Fase 4)");
  it.todo("Customer.storeCreditCents = Σ StoreCreditEntry.amountCents (Fase 4)");
});
