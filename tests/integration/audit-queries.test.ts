import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { searchAuditLog, AUDIT_PAGE_SIZE } from "@/modules/audit/queries";
import { parseAuditFilters } from "@/modules/audit/schemas";

import { closeDatabase, resetDatabase, testDb } from "./helpers/db";

async function entry(overrides: {
  action?: "SALE_VOIDED" | "PRICE_CHANGED" | "USER_CREATED";
  userId?: string | null;
  entityType?: string;
  createdAt?: Date;
}) {
  return testDb.auditLog.create({
    data: {
      action: overrides.action ?? "PRICE_CHANGED",
      userId: overrides.userId ?? null,
      entityType: overrides.entityType ?? "Product",
      entityId: "e-1",
      createdAt: overrides.createdAt,
    },
  });
}

describe("searchAuditLog", () => {
  beforeEach(resetDatabase);
  afterAll(closeDatabase);

  it("returns newest first and names the user, or none for system entries", async () => {
    const user = await testDb.user.create({
      data: { name: "Dueña", username: "owner", passwordHash: "x", role: "OWNER" },
    });
    await entry({ userId: user.id, createdAt: new Date("2026-10-01T12:00:00Z") });
    await entry({ createdAt: new Date("2026-10-02T12:00:00Z") });

    const result = await searchAuditLog(parseAuditFilters({}), testDb);
    expect(result.total).toBe(2);
    expect(result.rows.map((row) => row.createdAt.toISOString())).toEqual([
      "2026-10-02T12:00:00.000Z",
      "2026-10-01T12:00:00.000Z",
    ]);
    expect(result.rows[0]?.user).toBeNull();
    expect(result.rows[1]?.user?.name).toBe("Dueña");
  });

  it("filters by action, user and entity type", async () => {
    const user = await testDb.user.create({
      data: { name: "Gerente", username: "gerente", passwordHash: "x", role: "MANAGER" },
    });
    await entry({ action: "SALE_VOIDED", entityType: "Sale", userId: user.id });
    await entry({ action: "PRICE_CHANGED", entityType: "Product" });
    await entry({ action: "USER_CREATED", entityType: "User" });

    const byAction = await searchAuditLog(parseAuditFilters({ action: "SALE_VOIDED" }), testDb);
    expect(byAction.rows.map((row) => row.action)).toEqual(["SALE_VOIDED"]);

    const byUser = await searchAuditLog(parseAuditFilters({ userId: user.id }), testDb);
    expect(byUser.total).toBe(1);

    const byEntity = await searchAuditLog(parseAuditFilters({ entityType: "User" }), testDb);
    expect(byEntity.rows.map((row) => row.action)).toEqual(["USER_CREATED"]);
  });

  it("filters by local calendar day (UTC−6), including the day boundary", async () => {
    // 05:30Z = 22/10 23:30 local · 06:00Z = 23/10 00:00 local
    await entry({ createdAt: new Date("2026-10-23T05:30:00.000Z") });
    await entry({ createdAt: new Date("2026-10-23T06:00:00.000Z") });

    const day22 = await searchAuditLog(
      parseAuditFilters({ from: "2026-10-22", to: "2026-10-22" }),
      testDb,
    );
    expect(day22.rows.map((row) => row.createdAt.toISOString())).toEqual([
      "2026-10-23T05:30:00.000Z",
    ]);

    const day23 = await searchAuditLog(
      parseAuditFilters({ from: "2026-10-23", to: "2026-10-23" }),
      testDb,
    );
    expect(day23.rows.map((row) => row.createdAt.toISOString())).toEqual([
      "2026-10-23T06:00:00.000Z",
    ]);

    const both = await searchAuditLog(
      parseAuditFilters({ from: "2026-10-22", to: "2026-10-23" }),
      testDb,
    );
    expect(both.total).toBe(2);
  });

  it("ignores a malformed date filter instead of failing", async () => {
    await entry({});
    const result = await searchAuditLog(parseAuditFilters({ from: "no-es-fecha" }), testDb);
    expect(result.total).toBe(1);
  });

  it("paginates", async () => {
    const total = AUDIT_PAGE_SIZE + 5;
    await testDb.auditLog.createMany({
      data: Array.from({ length: total }, (_, index) => ({
        action: "PRICE_CHANGED",
        entityType: "Product",
        entityId: `p-${index}`,
        createdAt: new Date(Date.UTC(2026, 9, 1, 0, index)),
      })),
    });

    const first = await searchAuditLog(parseAuditFilters({}), testDb);
    expect(first).toMatchObject({ total, page: 1, pages: 2 });
    expect(first.rows).toHaveLength(AUDIT_PAGE_SIZE);

    const second = await searchAuditLog(parseAuditFilters({ page: "2" }), testDb);
    expect(second.rows).toHaveLength(5);
    expect(second.rows[0]?.entityId).toBe("p-4");
  });
});
