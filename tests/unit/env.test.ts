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

  it("does not apply the production checks to a local installation", () => {
    const env = parseEnv({ ...validSource, NODE_ENV: "production" });
    expect(env.DEPLOYMENT).toBe("local");
  });
});

describe("parseEnv with DEPLOYMENT=production", () => {
  const production = {
    DEPLOYMENT: "production",
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://boutique:Xk29sLq8vTn4@db:5432/boutique_pos?schema=public",
    AUTH_SECRET: "Zr7mQ2xVb9TnW4kP8sLd1HgF6jYc3EaU5oIt0NqRw",
    APP_URL: "https://tienda.mi-boutique.hn",
  };

  it("accepts a real configuration", () => {
    expect(parseEnv(production).DEPLOYMENT).toBe("production");
  });

  it.each([
    ["APP_URL", { APP_URL: "http://tienda.mi-boutique.hn" }, /APP_URL debe usar https/],
    ["NODE_ENV", { NODE_ENV: "development" }, /NODE_ENV debe ser production/],
    [
      "AUTH_SECRET",
      { AUTH_SECRET: "replace-with-a-random-secret-of-32-chars-or-more" },
      /AUTH_SECRET es un texto de ejemplo/,
    ],
    [
      "AUTH_SECRET",
      { AUTH_SECRET: "ci-only-secret-with-at-least-32-characters-0000" },
      /AUTH_SECRET es un texto de ejemplo/,
    ],
    [
      "DATABASE_URL",
      { DATABASE_URL: "postgresql://boutique:change-me-local-only@db:5432/boutique_pos" },
      /DATABASE_URL tiene la contraseña de ejemplo/,
    ],
  ])("rejects an unsafe %s", (_name, override, message) => {
    expect(() => parseEnv({ ...production, ...override })).toThrow(message);
  });
});
