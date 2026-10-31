import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { openCashSession } from "@/modules/cash/service";
import { verifyBooks } from "@/modules/ops/verify-books";
import { lookupCode, searchSellable } from "@/modules/sales/pos-queries";
import { completeSale } from "@/modules/sales/service";
import { generateHistory } from "../../prisma/seed/history";
import { runSeed } from "../../prisma/seed/run-seed";

import { closeDatabase, resetDatabase, testDb } from "./helpers/db";

/**
 * La venta de todos los días con un catálogo y un historial del tamaño de una tienda real (500 prendas, miles de variantes
 * y tres meses de ventas): buscar, escanear y cobrar tienen que seguir siendo rápidos. Se mide primero y se pone un límite
 * generoso (para no depender de qué tan cargada esté la máquina); las cifras reales quedan en el registro de la prueba y en
 * `docs/ARCHITECTURE.md`.
 */

type Actor = { id: string; role: Role };

const LIMITS_MS = { search: 300, lookup: 100, sale: 500 };
const timings: Record<"search" | "lookup" | "sale", number[]> = {
  search: [],
  lookup: [],
  sale: [],
};

let cashier: Actor;
let sellable: { variantId: string; barcode: string }[] = [];

const p = (values: number[], percentile: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * percentile))] ?? 0,
  );
};

async function timed<T>(bucket: keyof typeof timings, run: () => Promise<T>): Promise<T> {
  const started = performance.now();
  const result = await run();
  (timings[bucket] as number[]).push(performance.now() - started);
  return result;
}

beforeAll(async () => {
  await resetDatabase();
  await runSeed(testDb);
  await generateHistory(testDb, { months: 3, salesPerDay: 24, products: 500, seed: 11 });

  const owner = await testDb.user.findUniqueOrThrow({ where: { username: "owner" } });
  cashier = { id: owner.id, role: "OWNER" };
  await openCashSession(cashier, { openingFloatCents: 100_000 }, testDb);

  const levels = await testDb.stockLevel.findMany({
    where: { onHand: { gte: 5 } },
    select: { variant: { select: { id: true, barcode: true } } },
    take: 400,
  });
  sellable = levels.flatMap((level) =>
    level.variant.barcode ? [{ variantId: level.variant.id, barcode: level.variant.barcode }] : [],
  );
}, 600_000);

afterAll(async () => {
  console.info(
    `catálogo de 500 prendas, 3 meses de historia · p50/p95 en ms · búsqueda ${p(timings.search, 0.5)}/${p(timings.search, 0.95)} · código de barras ${p(timings.lookup, 0.5)}/${p(timings.lookup, 0.95)} · venta de 3 prendas ${p(timings.sale, 0.5)}/${p(timings.sale, 0.95)}`,
  );
  await db.$disconnect();
  await closeDatabase();
});

describe("the everyday sale on a store-sized catalog", () => {
  it("has enough garments to sell", () => {
    expect(sellable.length).toBeGreaterThan(100);
  });

  it("searches the catalog by name, by words in any order and by code", async () => {
    const queries = [
      "vestido",
      "blusa lino",
      "camisa",
      "HIST-120",
      "hist-007",
      "bolso",
      "jean",
      "zapato negro",
      "falda",
      "",
    ];
    for (let round = 0; round < 4; round += 1) {
      for (const q of queries) {
        await timed("search", () => searchSellable({ q }, testDb));
      }
    }
    expect(p(timings.search, 0.95)).toBeLessThan(LIMITS_MS.search);
  });

  it("finds a garment by its barcode", async () => {
    for (const item of sellable.slice(0, 60)) {
      const result = await timed("lookup", () => lookupCode(item.barcode, testDb));
      expect(result.kind).not.toBe("none");
    }
    expect(p(timings.lookup, 0.95)).toBeLessThan(LIMITS_MS.lookup);
  });

  it("rings up a three-garment sale in cash, one after another", async () => {
    for (let index = 0; index < 40; index += 1) {
      const lines = [0, 1, 2].map((offset) => ({
        variantId: (sellable[(index * 3 + offset) % sellable.length] as { variantId: string })
          .variantId,
        quantity: 1,
      }));
      const sale = await timed("sale", () =>
        completeSale(
          cashier,
          {
            clientRequestId: `load-sale-${index}`,
            lines,
            // Más que suficiente en efectivo: el vuelto sale de la misma venta
            payments: [{ method: "CASH", amountCents: 500_000 }],
          },
          testDb,
        ),
      );
      expect(sale.replayed).toBe(false);
    }
    expect(p(timings.sale, 0.95)).toBeLessThan(LIMITS_MS.sale);
  });

  it("leaves the books balanced after the history and the new sales", async () => {
    const report = await verifyBooks(testDb);
    expect(report.problems).toEqual([]);
  });
});
