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

describe("parseEnv — platform (SaaS)", () => {
  const key = Buffer.alloc(32, 9).toString("base64url");
  const platform = {
    TENANCY_MODE: "multi",
    PLATFORM_HOST: "admin.tuplataforma.com",
    TENANT_BASE_DOMAIN: "tuplataforma.com",
    CONTROL_DATABASE_URL: "postgresql://u:p@localhost:5432/control",
    PLATFORM_MASTER_KEY: key,
  };

  it("is off by default and treats empty variables as unset", () => {
    const env = parseEnv({
      ...validSource,
      PLATFORM_HOST: "",
      PLATFORM_MASTER_KEY: "  ",
      TENANT_BASE_DOMAIN: "",
      TENANT_DB_PORT: "",
      TENANT_DIRECTORY_TTL_MS: "",
      PLATFORM_MASTER_KEY_PREVIOUS_VERSION: "",
    });
    expect(env.TENANCY_MODE).toBe("single");
    expect(env.PLATFORM_HOST).toBeUndefined();
    expect(env.PLATFORM_MASTER_KEY).toBeUndefined();
    expect(env.TENANT_BASE_DOMAIN).toBeUndefined();
    expect(env.TENANT_DB_PORT).toBeUndefined();
    expect(env.TENANT_DIRECTORY_TTL_MS).toBeUndefined();
    expect(env.PLATFORM_LOGIN_RATE_LIMIT_MAX).toBe(10);
  });

  it("accepts a complete configuration, with or without a port", () => {
    expect(parseEnv({ ...validSource, ...platform }).PLATFORM_HOST).toBe("admin.tuplataforma.com");
    expect(
      parseEnv({ ...validSource, ...platform, PLATFORM_HOST: "admin.localhost:3000" }),
    ).toBeTruthy();
  });

  it("multi-business mode works without a panel (a business-only instance)", () => {
    const { PLATFORM_HOST, ...withoutPanel } = platform;
    void PLATFORM_HOST;
    expect(parseEnv({ ...validSource, ...withoutPanel }).TENANCY_MODE).toBe("multi");
  });

  it("reads the optional numbers", () => {
    const env = parseEnv({
      ...validSource,
      ...platform,
      TENANT_DB_HOST: "pg.interno",
      TENANT_DB_PORT: "6543",
      TENANT_DIRECTORY_TTL_MS: "300",
    });
    expect(env.TENANT_DB_HOST).toBe("pg.interno");
    expect(env.TENANT_DB_PORT).toBe(6543);
    expect(env.TENANT_DIRECTORY_TTL_MS).toBe(300);
  });

  it.each([
    [
      "the panel in single-business mode",
      { TENANCY_MODE: "single" },
      /PLATFORM_HOST solo se admite con TENANCY_MODE=multi/,
    ],
    ["a PLATFORM_HOST with a scheme", { PLATFORM_HOST: "https://admin.x.com" }, /PLATFORM_HOST/],
    ["a PLATFORM_HOST with a path", { PLATFORM_HOST: "admin.x.com/panel" }, /PLATFORM_HOST/],
    ["no control database", { CONTROL_DATABASE_URL: "" }, /CONTROL_DATABASE_URL es obligatoria/],
    ["no master key", { PLATFORM_MASTER_KEY: "" }, /PLATFORM_MASTER_KEY es obligatoria/],
    ["no base domain", { TENANT_BASE_DOMAIN: "" }, /TENANT_BASE_DOMAIN es obligatorio/],
    [
      "a base domain with a scheme",
      { TENANT_BASE_DOMAIN: "https://tuplataforma.com" },
      /TENANT_BASE_DOMAIN debe ser solo un dominio/,
    ],
    [
      "a base domain with a port",
      { TENANT_BASE_DOMAIN: "tuplataforma.com:3000" },
      /TENANT_BASE_DOMAIN debe ser solo un dominio/,
    ],
    ["a database host with a path", { TENANT_DB_HOST: "pg/x" }, /TENANT_DB_HOST/],
    ["a database port out of range", { TENANT_DB_PORT: "70000" }, /TENANT_DB_PORT/],
    ["a master key of the wrong size", { PLATFORM_MASTER_KEY: "corta" }, /32 bytes/],
    ["a previous key of the wrong size", { PLATFORM_MASTER_KEY_PREVIOUS: "corta" }, /32 bytes/],
  ])("rejects %s", (_name, override, message) => {
    expect(() => parseEnv({ ...validSource, ...platform, ...override })).toThrow(message);
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

  describe("multi-business mode with the platform panel", () => {
    const withPlatform = {
      ...production,
      TENANCY_MODE: "multi",
      PLATFORM_HOST: "admin.mi-plataforma.hn",
      TENANT_BASE_DOMAIN: "mi-plataforma.hn",
      CONTROL_DATABASE_URL: "postgresql://control:Qw81nXz7LkP2@db:5432/control",
      PLATFORM_MASTER_KEY: Buffer.alloc(32, 5).toString("base64url"),
    };

    it("is allowed in production since stage 2", () => {
      const env = parseEnv(withPlatform);
      expect(env.TENANCY_MODE).toBe("multi");
      expect(env.TENANT_BASE_DOMAIN).toBe("mi-plataforma.hn");
    });

    it("is not allowed without multi-business mode", () => {
      expect(() => parseEnv({ ...withPlatform, TENANCY_MODE: "single" })).toThrow(
        /solo se admite con TENANCY_MODE=multi/,
      );
    });

    it("requires the panel: without it the businesses cannot be administered", () => {
      expect(() => parseEnv({ ...withPlatform, PLATFORM_HOST: "" })).toThrow(
        /hace falta PLATFORM_HOST/,
      );
    });

    it.each([
      [
        "a local PLATFORM_HOST",
        { PLATFORM_HOST: "admin.localhost" },
        /PLATFORM_HOST no puede ser un host local/,
      ],
      [
        "a local base domain",
        { TENANT_BASE_DOMAIN: "localhost" },
        /TENANT_BASE_DOMAIN no puede ser un host local/,
      ],
      [
        "a *.localhost base domain",
        { TENANT_BASE_DOMAIN: "negocios.localhost" },
        /TENANT_BASE_DOMAIN no puede ser un host local/,
      ],
      [
        "the example base domain",
        { TENANT_BASE_DOMAIN: "tuplataforma.example.com" },
        /TENANT_BASE_DOMAIN es un texto de ejemplo/,
      ],
      [
        "the example panel host",
        { PLATFORM_HOST: "admin.example.com" },
        /PLATFORM_HOST es un texto de ejemplo/,
      ],
      [
        "the example control database password",
        { CONTROL_DATABASE_URL: "postgresql://c:change-me-local-only@db/control" },
        /CONTROL_DATABASE_URL tiene la contraseña de ejemplo/,
      ],
      [
        "a placeholder text instead of a master key",
        { PLATFORM_MASTER_KEY: "replace-with-a-generated-key" },
        /32 bytes/,
      ],
    ])("also rejects %s", (_name, override, message) => {
      expect(() => parseEnv({ ...withPlatform, ...override })).toThrow(message);
    });
  });
});
