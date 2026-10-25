import { afterAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { checkDatabase, createHealthHandler, pingDatabase } from "@/lib/health";

describe("health", () => {
  afterAll(() => db.$disconnect());

  it("answers 200 and ok against the test database", async () => {
    const response = await createHealthHandler(pingDatabase)();
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
});
