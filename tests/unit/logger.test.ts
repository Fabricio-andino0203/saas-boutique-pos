import { afterEach, describe, expect, it, vi } from "vitest";

import { formatLogLine, logger, sanitize } from "@/lib/logger";
import { runWithTenant } from "@/lib/tenancy/tenant-context";

afterEach(() => vi.unstubAllEnvs());

function parse(line: string): Record<string, unknown> {
  return JSON.parse(line) as Record<string, unknown>;
}

describe("formatLogLine — business", () => {
  const tenant = { id: "ten1", slug: "tienda-a", databaseUrl: "postgresql://secreto@db/x" };

  it("adds no business outside a business context (single-store logs stay as they were)", () => {
    expect(parse(formatLogLine("info", "evento"))).not.toHaveProperty("tenant");
  });

  it("names the business when the work runs as one, by subdomain or by id", () => {
    expect(parse(runWithTenant(tenant, () => formatLogLine("info", "evento"))).tenant).toBe(
      "tienda-a",
    );
    expect(
      parse(
        runWithTenant({ id: "ten2", databaseUrl: "postgresql://x" }, () =>
          formatLogLine("info", "evento"),
        ),
      ).tenant,
    ).toBe("ten2");
  });

  it("lets the caller name the business explicitly, and never leaks the database url", () => {
    const line = runWithTenant(tenant, () => formatLogLine("warn", "evento", { tenant: "otra" }));
    expect(parse(line).tenant).toBe("otra");
    expect(line).not.toContain("secreto");
  });
});

describe("formatLogLine", () => {
  it("writes one JSON object with time, level and event", () => {
    const entry = parse(
      formatLogLine("info", "sale.completed", { saleId: "abc", totalCents: 11500 }),
    );
    expect(entry).toMatchObject({
      level: "info",
      event: "sale.completed",
      saleId: "abc",
      totalCents: 11500,
    });
    expect(new Date(entry.time as string).toISOString()).toBe(entry.time);
  });

  it("redacts secrets at any depth and whatever their casing", () => {
    const line = formatLogLine("warn", "auth.attempt", {
      password: "Contraseña-Real-1",
      pin: "482916",
      user: { username: "rosa", pinHash: "$argon2id$x", nested: { sessionToken: "t0k3n", ok: 1 } },
      headers: { Authorization: "Bearer abc", cookie: "boutique_session=zzz", accept: "text/html" },
      newPassword: "otra-cosa-2",
      AUTH_SECRET: "super-secreto",
    });
    for (const secret of [
      "Contraseña-Real-1",
      "482916",
      "$argon2id$x",
      "t0k3n",
      "Bearer abc",
      "boutique_session=zzz",
      "otra-cosa-2",
      "super-secreto",
    ]) {
      expect(line).not.toContain(secret);
    }
    const entry = parse(line) as {
      user: { username: string; nested: { ok: number } };
      headers: { accept: string };
    };
    expect(entry.user.username).toBe("rosa");
    expect(entry.user.nested.ok).toBe(1);
    expect(entry.headers.accept).toBe("text/html");
    expect(line).toContain("[REDACTED]");
  });

  it("serializes an error with its code and digest and hides the stack in production", () => {
    const error = Object.assign(new Error("falló algo"), { code: "P2002", digest: "d123" });
    vi.stubEnv("NODE_ENV", "production");
    const entry = parse(formatLogLine("error", "request.error", { error })) as {
      error: { name: string; message: string; code: string; digest: string; stack?: string };
    };
    expect(entry.error).toMatchObject({
      name: "Error",
      message: "falló algo",
      code: "P2002",
      digest: "d123",
    });
    expect(entry.error.stack).toBeUndefined();
  });

  it("limits the size of what it writes", () => {
    const long = "x".repeat(10_000);
    expect(String(sanitize(long)).length).toBeLessThan(2_100);
    const deep = { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } };
    expect(JSON.stringify(sanitize(deep))).toContain("[…]");
    const wide = sanitize({ list: Array.from({ length: 500 }, (_, i) => i) }) as { list: number[] };
    expect(wide.list).toHaveLength(50);
  });

  it("turns bigint and dates into text instead of failing", () => {
    const entry = parse(
      formatLogLine("info", "x", { big: BigInt(10), at: new Date("2026-10-30T12:00:00Z") }),
    );
    expect(entry).toMatchObject({ big: "10", at: "2026-10-30T12:00:00.000Z" });
  });
});

describe("logger", () => {
  it("sends info to stdout and errors to stderr, and honors LOG_LEVEL", () => {
    const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      vi.stubEnv("LOG_LEVEL", "info");
      logger.debug("not.shown");
      logger.info("shown.info");
      logger.error("shown.error");
      expect(out).toHaveBeenCalledTimes(1);
      expect(err).toHaveBeenCalledTimes(1);

      vi.stubEnv("LOG_LEVEL", "silent");
      logger.error("not.shown.either");
      expect(err).toHaveBeenCalledTimes(1);
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
  });
});
