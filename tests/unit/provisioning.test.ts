import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { ValidationError } from "@/lib/errors";
import { latestMigrationName } from "@/lib/tenancy/provision-steps";
import {
  DEFAULT_TEMPLATE_DB,
  describeFailure,
  parseProvisionInput,
  PROVISION_STEPS,
  provisioningAvailable,
  provisioningConfig,
  ProvisioningUnavailableError,
  type ProvisionInput,
} from "@/modules/platform/provisioning";
import { parseEnv } from "@/lib/env";

const valid: ProvisionInput = {
  slug: "Mi-Tienda",
  name: "  Mi Tienda  ",
  ownerName: " Rosa Pérez ",
  ownerUsername: " Rosa ",
  ownerPassword: "Temporal-2026",
};

describe("parseProvisionInput", () => {
  it("normalizes what the person typed", () => {
    expect(parseProvisionInput(valid)).toEqual({
      slug: "mi-tienda",
      name: "Mi Tienda",
      ownerName: "Rosa Pérez",
      ownerUsername: "rosa",
      ownerPassword: "Temporal-2026",
      ownerEmail: null,
    });
    expect(parseProvisionInput({ ...valid, ownerEmail: " rosa@tienda.hn " }).ownerEmail).toBe(
      "rosa@tienda.hn",
    );
    expect(parseProvisionInput({ ...valid, ownerEmail: "  " }).ownerEmail).toBeNull();
  });

  it.each([
    ["a reserved subdomain", { slug: "admin" }, /reservado/],
    ["a subdomain with a space", { slug: "mi tienda" }, /subdominio/],
    ["a subdomain that starts with a dash", { slug: "-tienda" }, /subdominio/],
    ["a subdomain longer than 40", { slug: "a".repeat(41) }, /subdominio/],
    ["a one-letter business name", { name: "x" }, /nombre del negocio/],
    ["a one-letter owner name", { ownerName: "x" }, /nombre del propietario/],
    ["an owner username with a space", { ownerUsername: "rosa perez" }, /usuario del propietario/],
    ["a short temporary password", { ownerPassword: "corta" }, /contraseña temporal/],
    ["an email without an at sign", { ownerEmail: "rosa.tienda.hn" }, /correo/],
  ] as const)("rejects %s", (_name, override, message) => {
    expect(() => parseProvisionInput({ ...valid, ...override })).toThrow(ValidationError);
    expect(() => parseProvisionInput({ ...valid, ...override })).toThrow(message);
  });
});

describe("describeFailure", () => {
  it("never keeps the password of a connection string, and stays short", () => {
    const text = describeFailure(
      new Error(
        "no se pudo conectar a postgresql://admin:S3cr3t@db:5432/x y a postgres://u:p@h/db",
      ),
    );
    expect(text).not.toContain("S3cr3t");
    expect(text).not.toContain("u:p@");
    expect(text).toContain("postgresql://***@db:5432/x");
    expect(describeFailure("a".repeat(5_000)).length).toBe(800);
    expect(describeFailure("texto suelto")).toBe("texto suelto");
  });
});

describe("provisioningConfig", () => {
  it("needs the provisioning account and defaults the template", () => {
    expect(() => provisioningConfig({}, {})).toThrow(ProvisioningUnavailableError);
    expect(provisioningConfig({}, { TENANT_PROVISIONING_URL: "postgresql://a" })).toEqual({
      adminUrl: "postgresql://a",
      templateDb: DEFAULT_TEMPLATE_DB,
    });
    expect(
      provisioningConfig(
        {},
        { TENANT_PROVISIONING_URL: "postgresql://a", TENANT_TEMPLATE_DB: "mi_plantilla" },
      ).templateDb,
    ).toBe("mi_plantilla");
    expect(provisioningConfig({ adminUrl: "postgresql://b", templateDb: "otra" }, {})).toEqual({
      adminUrl: "postgresql://b",
      templateDb: "otra",
    });
  });

  it("treats empty variables (as an unset compose value leaves them) as undefined", () => {
    expect(
      provisioningConfig({}, { TENANT_PROVISIONING_URL: "postgresql://a", TENANT_TEMPLATE_DB: "" })
        .templateDb,
    ).toBe(DEFAULT_TEMPLATE_DB);
    expect(() => provisioningConfig({}, { TENANT_PROVISIONING_URL: "" })).toThrow(
      ProvisioningUnavailableError,
    );
    expect(provisioningAvailable({ TENANT_PROVISIONING_URL: "" })).toBe(false);
  });

  it("refuses a template name that is not a safe identifier", () => {
    expect(() =>
      provisioningConfig({ adminUrl: "postgresql://a", templateDb: 'x"; DROP DATABASE y; --' }, {}),
    ).toThrow(/Identificador inválido/);
  });

  it("says whether provisioning is available", () => {
    expect(provisioningAvailable({})).toBe(false);
    expect(provisioningAvailable({ TENANT_PROVISIONING_URL: "postgresql://a" })).toBe(true);
  });
});

describe("the recipe", () => {
  it("has the seven steps in order, ending in finalize", () => {
    expect(PROVISION_STEPS).toEqual([
      "validate",
      "role",
      "database",
      "migrate",
      "seed",
      "owner",
      "finalize",
    ]);
  });
});

describe("latestMigrationName", () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const dir of dirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("takes the newest migration folder and ignores anything else", () => {
    const dir = mkdtempSync(join(tmpdir(), "migrations-"));
    dirs.push(dir);
    for (const name of ["20261023000000_init", "20261027000400_layaways", "20260101000000_old"]) {
      mkdirSync(join(dir, name));
    }
    mkdirSync(join(dir, "no_es_migracion"));
    expect(latestMigrationName(dir)).toBe("20261027000400_layaways");
  });

  it("fails clearly when there are none, and for the real project returns a 14-digit timestamp", () => {
    const empty = mkdtempSync(join(tmpdir(), "migrations-"));
    dirs.push(empty);
    expect(() => latestMigrationName(empty)).toThrow(/No hay migraciones/);
    expect(latestMigrationName()).toMatch(/^\d{14}_/);
  });
});

describe("the provisioning variables", () => {
  const base = {
    DATABASE_URL: "postgresql://u:p@localhost:5432/db",
    AUTH_SECRET: "x".repeat(32),
    APP_URL: "http://localhost:3000",
  };

  it("accepts a PostgreSQL url and a template name, and treats empty as unset", () => {
    const env = parseEnv({
      ...base,
      TENANT_PROVISIONING_URL: "postgresql://boutique:Xk29@db:5432/postgres",
      TENANT_TEMPLATE_DB: "boutique_plantilla",
    });
    expect(env.TENANT_PROVISIONING_URL).toContain("postgresql://");
    expect(env.TENANT_TEMPLATE_DB).toBe("boutique_plantilla");
    const empty = parseEnv({ ...base, TENANT_PROVISIONING_URL: "", TENANT_TEMPLATE_DB: "" });
    expect(empty.TENANT_PROVISIONING_URL).toBeUndefined();
    expect(empty.TENANT_TEMPLATE_DB).toBeUndefined();
  });

  it.each([
    ["a non-PostgreSQL url", { TENANT_PROVISIONING_URL: "mysql://x" }, /TENANT_PROVISIONING_URL/],
    ["an unsafe template name", { TENANT_TEMPLATE_DB: "Mi Plantilla" }, /TENANT_TEMPLATE_DB/],
  ])("rejects %s", (_name, override, message) => {
    expect(() => parseEnv({ ...base, ...override })).toThrow(message);
  });

  it("in production rejects the example password of the provisioning account", () => {
    const production = {
      DEPLOYMENT: "production",
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://boutique:Xk29sLq8vTn4@db:5432/boutique_pos?schema=public",
      AUTH_SECRET: "Zr7mQ2xVb9TnW4kP8sLd1HgF6jYc3EaU5oIt0NqRw",
      APP_URL: "https://admin.mi-plataforma.hn",
      UPLOADS_DIR: "/data/uploads",
      TENANCY_MODE: "multi",
      PLATFORM_HOST: "admin.mi-plataforma.hn",
      TENANT_BASE_DOMAIN: "mi-plataforma.hn",
      CONTROL_DATABASE_URL: "postgresql://control:Qw81nXz7LkP2@db:5432/control",
      PLATFORM_MASTER_KEY: Buffer.alloc(32, 5).toString("base64url"),
    };
    expect(() =>
      parseEnv({
        ...production,
        TENANT_PROVISIONING_URL: "postgresql://boutique:change-me-local-only@db:5432/postgres",
      }),
    ).toThrow(/TENANT_PROVISIONING_URL tiene la contraseña de ejemplo/);
    expect(
      parseEnv({
        ...production,
        TENANT_PROVISIONING_URL: "postgresql://boutique:Xk29sLq8vTn4@db:5432/postgres",
      }).TENANT_PROVISIONING_URL,
    ).toBeDefined();
  });
});
