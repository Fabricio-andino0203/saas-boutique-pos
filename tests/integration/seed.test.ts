import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { verifySecret } from "../../src/lib/password";
import { DEMO_USERS, runSeed } from "../../prisma/seed/run-seed";

import { closeDatabase, resetDatabase, testDb } from "./helpers/db";

describe("runSeed", () => {
  beforeAll(async () => {
    await resetDatabase();
    await runSeed(testDb);
    await runSeed(testDb);
  });
  afterAll(closeDatabase);

  it("creates the four demo users with their roles", async () => {
    for (const demo of DEMO_USERS) {
      const user = await testDb.user.findUniqueOrThrow({ where: { username: demo.username } });
      expect(user.role).toBe(demo.role);
    }
  });

  it("stores verifiable password and PIN hashes", async () => {
    const cashier = await testDb.user.findUniqueOrThrow({ where: { username: "cashier" } });
    expect(await verifySecret(cashier.passwordHash, "Demo-Cajero-2026")).toBe(true);
    expect(await verifySecret(cashier.pinHash ?? "", "3333")).toBe(true);
  });

  it("creates the default location and its terminal", async () => {
    const main = await testDb.location.findUniqueOrThrow({ where: { code: "MAIN" } });
    expect(main.isDefault).toBe(true);
    const terminal = await testDb.terminal.findFirst({
      where: { name: "Caja 1", locationId: main.id },
    });
    expect(terminal).not.toBeNull();
  });

  it("creates sizes, colors and categories", async () => {
    const xs = await testDb.size.findUniqueOrThrow({ where: { name: "XS" } });
    const xxl = await testDb.size.findUniqueOrThrow({ where: { name: "XXL" } });
    const s34 = await testDb.size.findUniqueOrThrow({ where: { name: "34" } });
    const s42 = await testDb.size.findUniqueOrThrow({ where: { name: "42" } });
    expect([xs.group, xxl.group, s34.group, s42.group]).toEqual([
      "ropa",
      "ropa",
      "calzado",
      "calzado",
    ]);
    const black = await testDb.color.findUniqueOrThrow({ where: { name: "Negro" } });
    expect(black.hex).toBe("#1A1A1A");
    const dresses = await testDb.category.findUniqueOrThrow({ where: { slug: "mujer-vestidos" } });
    const women = await testDb.category.findUniqueOrThrow({ where: { slug: "mujer" } });
    expect(dresses.parentId).toBe(women.id);
  });

  it("creates the default settings", async () => {
    const expected: Record<string, unknown> = {
      "tax.rate": 1500,
      "tax.pricesIncludeTax": true,
      "sales.allowNegativeStock": false,
      "discount.maxPercent.CASHIER": 10,
      "returns.maxDays": 8,
      "layaway.expiryDays": 30,
      "ticket.footer": "¡Gracias por tu compra!",
    };
    for (const [key, value] of Object.entries(expected)) {
      const setting = await testDb.setting.findUniqueOrThrow({ where: { key } });
      expect(setting.valueJson, key).toBe(value);
    }
  });

  it("creates the five document counters", async () => {
    for (const key of ["SALE", "RETURN", "LAYAWAY", "PURCHASE_ORDER", "GOODS_RECEIPT"]) {
      expect(await testDb.documentCounter.findUnique({ where: { key } }), key).not.toBeNull();
    }
  });

  it("does not reset counters nor rehash existing users on a later run", async () => {
    await testDb.documentCounter.update({ where: { key: "SALE" }, data: { nextValue: 5 } });
    const before = await testDb.user.findUniqueOrThrow({ where: { username: "owner" } });
    await runSeed(testDb);
    const after = await testDb.user.findUniqueOrThrow({ where: { username: "owner" } });
    expect(
      (await testDb.documentCounter.findUniqueOrThrow({ where: { key: "SALE" } })).nextValue,
    ).toBe(5);
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(after.pinHash).toBe(before.pinHash);
  });
});

describe("runSeed in production", () => {
  afterEach(() => vi.unstubAllEnvs());
  afterAll(closeDatabase);

  it("refuses to run and writes nothing", async () => {
    await resetDatabase();
    vi.stubEnv("NODE_ENV", "production");
    await expect(runSeed(testDb)).rejects.toThrow(/production/);
    expect(await testDb.user.findUnique({ where: { username: "owner" } })).toBeNull();
  });
});
