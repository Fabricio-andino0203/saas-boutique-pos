import { afterAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import {
  checkDatabase,
  checkHealth,
  countUnfinishedMigrations,
  createHealthHandler,
  pingDatabase,
  pingMigrations,
} from "@/lib/health";

describe("health", () => {
  afterAll(() => db.$disconnect());

  it("answers 200 and ok against the test database", async () => {
    const response = await createHealthHandler(checkHealth)();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("answers 503 with an exact body when the check fails", async () => {
    const response = await createHealthHandler(() => Promise.resolve(false))();
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('{"status":"error"}');
  });

  it("does not leak the original error text", async () => {
    const healthy = await checkDatabase(() => Promise.reject(new Error("detalle-secreto")));
    expect(healthy).toBe(false);
    const body = await createHealthHandler(() => Promise.resolve(healthy))().then((r) => r.text());
    expect(body).not.toContain("detalle-secreto");
  });

  it("returns true when the query resolves", async () => {
    expect(await checkDatabase(() => Promise.resolve(1))).toBe(true);
  });

  it("sees the database and every migration as finished", async () => {
    expect(await pingDatabase()).toBe(true);
    expect(await countUnfinishedMigrations()).toBe(0);
    expect(await pingMigrations()).toBe(true);
  });

  it("is not healthy while a migration is unfinished", async () => {
    await db.$executeRaw`
      INSERT INTO "_prisma_migrations" ("id", "checksum", "migration_name", "started_at", "applied_steps_count")
      VALUES ('test-unfinished-migration', 'x', '99990101000000_unfinished_for_test', now(), 0)
    `;
    try {
      expect(await countUnfinishedMigrations()).toBe(1);
      expect(await pingMigrations()).toBe(false);
      expect(await checkHealth()).toBe(false);
    } finally {
      await db.$executeRaw`DELETE FROM "_prisma_migrations" WHERE "id" = 'test-unfinished-migration'`;
    }
    expect(await checkHealth()).toBe(true);
  });
});
