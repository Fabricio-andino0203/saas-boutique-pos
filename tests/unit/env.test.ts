import { describe, expect, it } from "vitest";

import { parseEnv } from "@/lib/env";

const validSource = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  AUTH_SECRET: "x".repeat(32),
  APP_URL: "http://localhost:3000",
};

describe("parseEnv", () => {
  it("returns the defaults for a valid source", () => {
    const env = parseEnv(validSource);
    expect(env.TZ).toBe("America/Tegucigalpa");
    expect(env.NODE_ENV).toBe("development");
  });

  it("rejects a missing AUTH_SECRET", () => {
    const { AUTH_SECRET, ...rest } = validSource;
    void AUTH_SECRET;
    expect(() => parseEnv(rest)).toThrow(/AUTH_SECRET/);
  });

  it("rejects an AUTH_SECRET of 31 characters", () => {
    expect(() => parseEnv({ ...validSource, AUTH_SECRET: "x".repeat(31) })).toThrow(
      /AUTH_SECRET debe tener al menos 32 caracteres/,
    );
  });

  it("rejects a non-PostgreSQL DATABASE_URL", () => {
    expect(() => parseEnv({ ...validSource, DATABASE_URL: "mysql://u:p@localhost/db" })).toThrow(
      /DATABASE_URL debe ser una URL de PostgreSQL/,
    );
  });

  it("rejects an invalid APP_URL", () => {
    expect(() => parseEnv({ ...validSource, APP_URL: "no-es-una-url" })).toThrow(/APP_URL/);
  });
});
