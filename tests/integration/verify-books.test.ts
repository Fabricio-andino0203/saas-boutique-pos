import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { verifyBooks, type BookCheck } from "@/modules/ops/verify-books";
import { generateHistory } from "../../prisma/seed/history";
import { runSeed } from "../../prisma/seed/run-seed";

import { closeDatabase, resetDatabase, testDb } from "./helpers/db";

/**
 * `verifyBooks` es lo que decide si un respaldo restaurado sirve. Se prueba con dos meses de historia generada (libros
 * cuadrados por construcción) y luego estropeando una cosa a la vez: cada estropicio debe aparecer con su propio nombre, y
 * al deshacerlo los libros vuelven a cuadrar.
 */

beforeAll(async () => {
  await resetDatabase();
  await runSeed(testDb);
  await generateHistory(testDb, { months: 2, salesPerDay: 6, products: 10, seed: 7 });
}, 120_000);

afterAll(closeDatabase);

async function checksFound(): Promise<BookCheck[]> {
  return [...new Set((await verifyBooks(testDb)).problems.map((problem) => problem.check))];
}

/** Aplica un estropicio, comprueba qué revisión lo ve y lo deshace. */
async function breakAndRestore(
  damage: () => Promise<unknown>,
  undo: () => Promise<unknown>,
  expected: BookCheck,
): Promise<void> {
  await damage();
  try {
    expect(await checksFound()).toContain(expected);
  } finally {
    await undo();
  }
  expect((await verifyBooks(testDb)).problems).toEqual([]);
}

describe("verifyBooks", () => {
  it("passes on a generated history and summarizes what it found", async () => {
    const report = await verifyBooks(testDb);
    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.summary.sales).toBeGreaterThan(100);
    expect(report.summary.users).toBeGreaterThan(0);
    expect(report.summary.lastSaleNumber).toMatch(/^T-\d{6}$/);
  });

  it("sees an inventory level that no longer matches the kardex", async () => {
    const level = await testDb.stockLevel.findFirstOrThrow({ orderBy: { variantId: "asc" } });
    await breakAndRestore(
      () =>
        testDb.stockLevel.update({ where: { id: level.id }, data: { onHand: level.onHand + 1 } }),
      () => testDb.stockLevel.update({ where: { id: level.id }, data: { onHand: level.onHand } }),
      "stock",
    );
  });

  it("sees a payment that no longer adds up to the sale", async () => {
    const payment = await testDb.payment.findFirstOrThrow({ orderBy: { id: "asc" } });
    await breakAndRestore(
      () =>
        testDb.payment.update({
          where: { id: payment.id },
          data: { amountCents: payment.amountCents + 100 },
        }),
      () =>
        testDb.payment.update({
          where: { id: payment.id },
          data: { amountCents: payment.amountCents },
        }),
      "sale-totals",
    );
  });

  it("sees a store credit balance that differs from its ledger", async () => {
    const customer = await testDb.customer.findFirstOrThrow({ orderBy: { id: "asc" } });
    await breakAndRestore(
      () =>
        testDb.customer.update({
          where: { id: customer.id },
          data: { storeCreditCents: customer.storeCreditCents + 500 },
        }),
      () =>
        testDb.customer.update({
          where: { id: customer.id },
          data: { storeCreditCents: customer.storeCreditCents },
        }),
      "credit",
    );
  });

  it("sees a document counter that fell behind the documents", async () => {
    const counter = await testDb.documentCounter.findUniqueOrThrow({ where: { key: "SALE" } });
    await breakAndRestore(
      () =>
        testDb.documentCounter.update({
          where: { key: "SALE" },
          data: { nextValue: counter.nextValue - 1 },
        }),
      () =>
        testDb.documentCounter.update({
          where: { key: "SALE" },
          data: { nextValue: counter.nextValue },
        }),
      "numbering",
    );
  });

  it("sees a closed shift whose saved expected cash is not the formula's", async () => {
    const session = await testDb.cashSession.findFirstOrThrow({
      where: { expectedCashCents: { not: null } },
      orderBy: { openedAt: "asc" },
    });
    const expected = session.expectedCashCents as number;
    await breakAndRestore(
      () =>
        testDb.cashSession.update({
          where: { id: session.id },
          data: { expectedCashCents: expected + 1000 },
        }),
      () =>
        testDb.cashSession.update({
          where: { id: session.id },
          data: { expectedCashCents: expected },
        }),
      "cash-sessions",
    );
  });

  it("sees that nobody could log in as an owner", async () => {
    await testDb.user.updateMany({ where: { role: "OWNER" }, data: { isActive: false } });
    try {
      expect(await checksFound()).toContain("owner");
    } finally {
      await testDb.user.updateMany({ where: { role: "OWNER" }, data: { isActive: true } });
    }
    expect((await verifyBooks(testDb)).problems).toEqual([]);
  });

  it("sees a migration that never finished", async () => {
    await testDb.$executeRaw`
      INSERT INTO "_prisma_migrations" ("id", "checksum", "migration_name", "started_at", "applied_steps_count")
      VALUES ('verify-books-unfinished', 'x', '99990101000000_unfinished_for_verify_test', now(), 0)
    `;
    try {
      expect(await checksFound()).toContain("migrations");
    } finally {
      await testDb.$executeRaw`DELETE FROM "_prisma_migrations" WHERE "id" = 'verify-books-unfinished'`;
    }
    expect((await verifyBooks(testDb)).ok).toBe(true);
  });
});
