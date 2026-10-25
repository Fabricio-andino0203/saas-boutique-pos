import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { audit } from "@/lib/audit";

import { assertTestDatabaseUrl, closeDatabase, resetDatabase, testDb } from "./helpers/db";

function errorText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    if (current instanceof Error) {
      parts.push(current.message);
    }
    if (typeof current === "object") {
      const record = current as { code?: unknown; meta?: unknown; cause?: unknown };
      if (record.code !== undefined) parts.push(String(record.code));
      if (record.meta !== undefined) parts.push(JSON.stringify(record.meta));
      current = record.cause;
    } else {
      current = undefined;
    }
  }
  return parts.join(" | ");
}

async function createUser() {
  return testDb.user.create({
    data: { name: "Dueña", username: "owner-audit", passwordHash: "x", role: "OWNER" },
  });
}

describe("audit.log", () => {
  beforeEach(resetDatabase);
  afterAll(closeDatabase);

  it("persists a row when the transaction commits", async () => {
    const user = await createUser();
    await testDb.$transaction(async (tx) =>
      audit.log(tx, {
        userId: user.id,
        action: "SALE_VOIDED",
        entityType: "Sale",
        entityId: "sale-1",
        reason: "Cliente devolvió la prenda",
        before: { status: "COMPLETED" },
        after: { status: "VOIDED" },
      }),
    );
    const row = await testDb.auditLog.findFirstOrThrow({ where: { entityId: "sale-1" } });
    expect(row.userId).toBe(user.id);
    expect(row.action).toBe("SALE_VOIDED");
    expect(row.entityType).toBe("Sale");
    expect(row.reason).toBe("Cliente devolvió la prenda");
    expect(row.before).toEqual({ status: "COMPLETED" });
    expect(row.after).toEqual({ status: "VOIDED" });
  });

  it("leaves no row when the transaction rolls back", async () => {
    const user = await createUser();
    await expect(
      testDb.$transaction(async (tx) => {
        await audit.log(tx, {
          userId: user.id,
          action: "SALE_VOIDED",
          entityType: "Sale",
          entityId: "sale-1",
        });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await testDb.auditLog.count({ where: { entityId: "sale-1" } })).toBe(0);
  });

  it("rejects UPDATE and DELETE on AuditLog and keeps the row", async () => {
    const user = await createUser();
    await audit.log(testDb, {
      userId: user.id,
      action: "PRICE_CHANGED",
      entityType: "Product",
      entityId: "p-1",
      reason: "original",
    });
    const update = testDb.$executeRaw`UPDATE "AuditLog" SET "reason" = 'x'`;
    await expect(update).rejects.toSatisfy((e: unknown) =>
      /solo inserción|23001/.test(errorText(e)),
    );
    const del = testDb.$executeRaw`DELETE FROM "AuditLog"`;
    await expect(del).rejects.toSatisfy((e: unknown) => /solo inserción|23001/.test(errorText(e)));
    const row = await testDb.auditLog.findFirstOrThrow({ where: { entityId: "p-1" } });
    expect(row.reason).toBe("original");
  });

  it("resetDatabase empties app tables but keeps _prisma_migrations", async () => {
    const user = await createUser();
    await audit.log(testDb, {
      userId: user.id,
      action: "STOCK_ADJUSTED",
      entityType: "Variant",
      entityId: "v-1",
    });
    const before = await testDb.$queryRaw<
      { n: bigint }[]
    >`SELECT count(*) AS n FROM "_prisma_migrations"`;
    expect(Number(before[0]?.n)).toBeGreaterThan(0);
    await resetDatabase();
    expect(await testDb.auditLog.count()).toBe(0);
    expect(await testDb.user.count()).toBe(0);
    const after = await testDb.$queryRaw<
      { n: bigint }[]
    >`SELECT count(*) AS n FROM "_prisma_migrations"`;
    expect(Number(after[0]?.n)).toBeGreaterThan(0);
  });

  it("assertTestDatabaseUrl only accepts databases ending in _test", () => {
    expect(() => assertTestDatabaseUrl("postgresql://u:p@localhost:5432/boutique_pos")).toThrow();
    expect(() =>
      assertTestDatabaseUrl("postgresql://u:p@localhost:5432/boutique_pos_test"),
    ).not.toThrow();
  });

  it("rejects actions outside AuditAction at type level", () => {
    const attempt = (): Promise<void> =>
      // @ts-expect-error acción fuera de AuditAction
      audit.log(testDb, { action: "ACCION_INVENTADA", entityType: "X", entityId: "1" });
    expect(typeof attempt).toBe("function");
  });
});
