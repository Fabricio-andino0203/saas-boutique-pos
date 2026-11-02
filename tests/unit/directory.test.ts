import { describe, expect, it, vi } from "vitest";

import {
  createControlDirectory,
  entryFromRecord,
  type RecordDeps,
  type TenantRecord,
} from "@/lib/tenancy/control-directory";
import {
  cachedDirectory,
  normalizeHost,
  staticDirectory,
  TenantDirectoryError,
  type DirectoryEntry,
} from "@/lib/tenancy/directory";
import { isReservedSlug, isValidSlug, slugFromHost } from "@/lib/tenancy/slug";
import { parseDatabaseUrl, serverEndpoint, tenantDatabaseUrl } from "@/lib/tenancy/tenant-url";
import { createVault, vaultContext } from "@/lib/tenancy/vault";

const vault = createVault({ version: 1, key: Buffer.alloc(32, 9) });
const deps: RecordDeps = {
  vault,
  endpointFor: () => ({ host: "db.interno", port: "5433" }),
};

function record(overrides: Partial<TenantRecord> = {}): TenantRecord {
  return {
    id: "ten1",
    slug: "tienda-a",
    name: "Tienda A",
    status: "ACTIVE",
    dbServerId: "primary",
    dbName: "t_ten1",
    dbRole: "t_ten1",
    dbCredentialEnc: vault.encrypt("secreto123", vaultContext.tenantDatabase("ten1")),
    ...overrides,
  };
}

describe("normalizeHost", () => {
  it("lowercases, trims and drops the port", () => {
    expect(normalizeHost("Tienda-A.Localhost:3000")).toBe("tienda-a.localhost");
    expect(normalizeHost("  a.b  ")).toBe("a.b");
  });

  it("rejects anything that does not look like a host name", () => {
    for (const bad of [null, undefined, "", "a b", "a/b", "a@b", "-a.com", "a.com-", "a_b.com"]) {
      expect(normalizeHost(bad), String(bad)).toBeUndefined();
    }
  });
});

describe("slugs", () => {
  it("accepts the format the database enforces and nothing else", () => {
    for (const good of ["a", "tienda-a", "a1", "x".repeat(40)]) {
      expect(isValidSlug(good), good).toBe(true);
    }
    for (const bad of ["", "-a", "a-", "A", "a_b", "a.b", "x".repeat(41), "ñandú"]) {
      expect(isValidSlug(bad), bad).toBe(false);
    }
  });

  it("reserves the names the platform and support use", () => {
    expect(isReservedSlug("admin")).toBe(true);
    expect(isReservedSlug("www")).toBe(true);
    expect(isReservedSlug("tienda-a")).toBe(false);
  });

  it("takes the slug from <slug>.<base> and from nothing else", () => {
    expect(slugFromHost("tienda-a.localhost", "localhost")).toBe("tienda-a");
    expect(slugFromHost("tienda-a.tuplataforma.com", "tuplataforma.com")).toBe("tienda-a");
    // un nivel exacto, sin el propio dominio base ni subniveles
    expect(slugFromHost("localhost", "localhost")).toBeUndefined();
    expect(slugFromHost("a.b.localhost", "localhost")).toBeUndefined();
    // otro dominio, aunque termine parecido
    expect(slugFromHost("tienda-a.evil.com", "tuplataforma.com")).toBeUndefined();
    expect(slugFromHost("tienda-a.xtuplataforma.com", "tuplataforma.com")).toBeUndefined();
    expect(slugFromHost("tienda-a.tuplataforma.com.evil.com", "tuplataforma.com")).toBeUndefined();
    // reservados y mal formados
    expect(slugFromHost("admin.localhost", "localhost")).toBeUndefined();
    expect(slugFromHost("-x.localhost", "localhost")).toBeUndefined();
    expect(slugFromHost(undefined, "localhost")).toBeUndefined();
    expect(slugFromHost("a.localhost", "")).toBeUndefined();
  });
});

describe("tenant database url", () => {
  it("builds the url with the role, the encoded password and the server of the tenant", () => {
    const url = tenantDatabaseUrl({
      endpoint: { host: "db.interno", port: "5433" },
      database: "t_ten1",
      role: "t_ten1",
      password: "p@ss:/w?d#",
    });
    expect(url).toBe("postgresql://t_ten1:p%40ss%3A%2Fw%3Fd%23@db.interno:5433/t_ten1");
    expect(parseDatabaseUrl(url)).toEqual({
      host: "db.interno",
      port: "5433",
      database: "t_ten1",
      role: "t_ten1",
      password: "p@ss:/w?d#",
    });
  });

  it("the primary server defaults to the one of the central database", () => {
    const control = "postgresql://u:p@pg.servidor:6543/central";
    expect(serverEndpoint("primary", { CONTROL_DATABASE_URL: control })).toEqual({
      host: "pg.servidor",
      port: "6543",
    });
    expect(
      serverEndpoint("primary", {
        CONTROL_DATABASE_URL: control,
        TENANT_DB_HOST: "otro",
        TENANT_DB_PORT: "5999",
      }),
    ).toEqual({ host: "otro", port: "5999" });
  });

  it("an empty variable counts as not defined (a compose file with no value passes it empty)", () => {
    const control = "postgresql://u:p@pg.servidor:6543/central";
    expect(
      serverEndpoint("primary", {
        CONTROL_DATABASE_URL: control,
        TENANT_DB_HOST: "",
        TENANT_DB_PORT: "",
      }),
    ).toEqual({ host: "pg.servidor", port: "6543" });
    expect(
      serverEndpoint("primary", {
        CONTROL_DATABASE_URL: control,
        TENANT_DB_HOST: "  ",
        TENANT_DB_PORT: " ",
      }),
    ).toEqual({ host: "pg.servidor", port: "6543" });
    expect(
      serverEndpoint("primary", {
        CONTROL_DATABASE_URL: "postgresql://u:p@pg.servidor/central",
        TENANT_DB_HOST: "",
        TENANT_DB_PORT: "",
      }),
    ).toEqual({ host: "pg.servidor", port: "5432" });
  });

  it("an unknown server fails instead of falling back to another one", () => {
    expect(() => serverEndpoint("segundo", { TENANT_DB_HOST: "x" })).toThrow(/desconocido/);
    expect(() => serverEndpoint("primary", {})).toThrow(/TENANT_DB_HOST/);
  });
});

describe("entryFromRecord — what each status does", () => {
  it("an active business gets its database url, with the password opened from the vault", () => {
    const entry = entryFromRecord(record(), deps);
    expect(entry).toEqual({
      state: "active",
      tenant: {
        id: "ten1",
        slug: "tienda-a",
        databaseUrl: "postgresql://t_ten1:secreto123@db.interno:5433/t_ten1",
      },
    });
  });

  it.each(["SUSPENDED", "PENDING_DELETION"] as const)(
    "%s is shown as suspended, without opening its credential",
    (status) => {
      const entry = entryFromRecord(record({ status, dbCredentialEnc: "basura" }), deps);
      expect(entry).toEqual({
        state: "suspended",
        tenant: { id: "ten1", slug: "tienda-a", name: "Tienda A" },
      });
    },
  );

  it("MIGRATION_FAILED is 'maintenance' and never opens its credential", () => {
    const entry = entryFromRecord(
      record({ status: "MIGRATION_FAILED", dbCredentialEnc: "basura" }),
      deps,
    );
    expect(entry).toEqual({
      state: "maintenance",
      tenant: { id: "ten1", slug: "tienda-a", name: "Tienda A" },
    });
  });

  it.each(["PROVISIONING", "FAILED", "DELETED"] as const)("%s serves nobody", (status) => {
    expect(entryFromRecord(record({ status }), deps)).toBeUndefined();
  });

  it("refuses a credential sealed for another business", () => {
    const stolen = vault.encrypt("secreto123", vaultContext.tenantDatabase("otro"));
    expect(() => entryFromRecord(record({ dbCredentialEnc: stolen }), deps)).toThrow(
      TenantDirectoryError,
    );
  });

  it("refuses an active business without database or credential", () => {
    expect(() => entryFromRecord(record({ dbCredentialEnc: null }), deps)).toThrow(
      TenantDirectoryError,
    );
    expect(() => entryFromRecord(record({ dbName: null }), deps)).toThrow(TenantDirectoryError);
  });
});

describe("createControlDirectory", () => {
  it("never asks the central database about a name that cannot be a business", async () => {
    const find = vi.fn(async () => record());
    const directory = createControlDirectory({ baseDomain: "localhost", find, deps: () => deps });
    for (const host of [
      "localhost",
      "admin.localhost",
      "a.b.localhost",
      "evil.com",
      "tienda-a.evil.com",
      "127.0.0.1",
    ]) {
      expect(await directory.lookupByHost(host), host).toBeUndefined();
    }
    expect(find).not.toHaveBeenCalled();
  });

  it("finds a business by <slug>.<base> and returns nothing for a slug that does not exist", async () => {
    const find = vi.fn(async (slug: string) => (slug === "tienda-a" ? record() : null));
    const directory = createControlDirectory({ baseDomain: "localhost", find, deps: () => deps });
    expect(await directory.lookupByHost("tienda-a.localhost:3000")).toMatchObject({
      state: "active",
    });
    expect(await directory.lookupByHost("tienda-b.localhost")).toBeUndefined();
    expect(find).toHaveBeenCalledTimes(2);
  });

  it("without a base domain nothing is a business (fails closed)", async () => {
    const find = vi.fn(async () => record());
    const directory = createControlDirectory({ baseDomain: undefined, find, deps: () => deps });
    expect(await directory.lookupByHost("tienda-a.localhost")).toBeUndefined();
    expect(find).not.toHaveBeenCalled();
  });

  it("turns a failure of the central database into a transient directory error", async () => {
    const find = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const directory = createControlDirectory({ baseDomain: "localhost", find, deps: () => deps });
    const error = await directory
      .lookupByHost("tienda-a.localhost")
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TenantDirectoryError);
    expect((error as TenantDirectoryError).transient).toBe(true);
  });

  it("a row that cannot be interpreted is a definitive, not transient, error", async () => {
    const find = vi.fn(async () => record({ dbCredentialEnc: "basura" }));
    const directory = createControlDirectory({ baseDomain: "localhost", find, deps: () => deps });
    const error = await directory
      .lookupByHost("tienda-a.localhost")
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TenantDirectoryError);
    expect((error as TenantDirectoryError).transient).toBe(false);
  });
});

describe("cachedDirectory", () => {
  const entry: DirectoryEntry = {
    state: "active",
    tenant: { id: "a", databaseUrl: "postgresql://a" },
  };

  function clock() {
    let now = 1_000_000;
    return { now: () => now, advance: (ms: number) => (now += ms) };
  }

  it("answers repeated questions from memory until the entry expires", async () => {
    const time = clock();
    const load = vi.fn(async () => entry);
    const directory = cachedDirectory(load, { ttlMs: 1_000, now: time.now });
    await directory.lookupByHost("a.localhost");
    await directory.lookupByHost("A.localhost:3000"); // el mismo host, escrito distinto
    expect(load).toHaveBeenCalledTimes(1);
    time.advance(999);
    await directory.lookupByHost("a.localhost");
    expect(load).toHaveBeenCalledTimes(1);
    time.advance(2);
    await directory.lookupByHost("a.localhost");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("shares one question between simultaneous requests for the same host", async () => {
    let resolve: (value: DirectoryEntry) => void = () => undefined;
    const load = vi.fn(() => new Promise<DirectoryEntry | undefined>((r) => (resolve = r)));
    const directory = cachedDirectory(load);
    const all = Promise.all(
      Array.from({ length: 25 }, () => directory.lookupByHost("a.localhost")),
    );
    resolve(entry);
    expect(await all).toEqual(Array(25).fill(entry));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("remembers 'nobody lives here' only briefly, so a new business shows up soon", async () => {
    const time = clock();
    let answer = undefined as DirectoryEntry | undefined;
    const load = vi.fn(async () => answer);
    const directory = cachedDirectory(load, { ttlMs: 60_000, negativeTtlMs: 500, now: time.now });
    expect(await directory.lookupByHost("nuevo.localhost")).toBeUndefined();
    expect(await directory.lookupByHost("nuevo.localhost")).toBeUndefined();
    expect(load).toHaveBeenCalledTimes(1);
    answer = entry;
    time.advance(501);
    expect(await directory.lookupByHost("nuevo.localhost")).toEqual(entry);
  });

  it("keeps serving a known business for a while when the central database fails", async () => {
    const time = clock();
    let failing = false;
    const onStale = vi.fn();
    const load = vi.fn(async () => {
      if (failing) {
        throw new TenantDirectoryError("caída", { transient: true });
      }
      return entry;
    });
    const directory = cachedDirectory(load, {
      ttlMs: 1_000,
      staleIfErrorMs: 60_000,
      now: time.now,
      onStale,
    });
    await directory.lookupByHost("a.localhost");
    failing = true;
    time.advance(5_000);
    expect(await directory.lookupByHost("a.localhost")).toEqual(entry);
    expect(onStale).toHaveBeenCalledTimes(1);
    // no insiste en cada petición: se vuelve a intentar pasados unos segundos
    const callsAfterFirstFailure = load.mock.calls.length;
    await directory.lookupByHost("a.localhost");
    expect(load.mock.calls.length).toBe(callsAfterFirstFailure);
    // pasado el margen, deja de servir lo viejo y avisa con un error
    time.advance(120_000);
    await expect(directory.lookupByHost("a.localhost")).rejects.toBeInstanceOf(
      TenantDirectoryError,
    );
  });

  it("does not hide a definitive problem of the row behind the old answer", async () => {
    const time = clock();
    let broken = false;
    const load = vi.fn(async () => {
      if (broken) {
        throw new TenantDirectoryError("credencial que no descifra"); // no transitorio
      }
      return entry;
    });
    const directory = cachedDirectory(load, { ttlMs: 1_000, now: time.now });
    await directory.lookupByHost("a.localhost");
    broken = true;
    time.advance(5_000);
    await expect(directory.lookupByHost("a.localhost")).rejects.toBeInstanceOf(
      TenantDirectoryError,
    );
  });

  it("never invents a business: an unknown host with the central database down is an error", async () => {
    const load = vi.fn(async () => {
      throw new TenantDirectoryError("caída", { transient: true });
    });
    const directory = cachedDirectory(load);
    await expect(directory.lookupByHost("nuevo.localhost")).rejects.toBeInstanceOf(
      TenantDirectoryError,
    );
  });

  it("is bounded: inventing many host names cannot fill the memory", async () => {
    const load = vi.fn(async () => undefined);
    const directory = cachedDirectory(load, { maxEntries: 50 });
    for (let index = 0; index < 500; index += 1) {
      await directory.lookupByHost(`h${index}.localhost`);
    }
    // los 50 más recientes siguen recordados, los viejos se olvidaron
    load.mockClear();
    await directory.lookupByHost("h499.localhost");
    expect(load).not.toHaveBeenCalled();
    await directory.lookupByHost("h0.localhost");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("can forget one host or all of them", async () => {
    const load = vi.fn(async () => entry);
    const directory = cachedDirectory(load);
    await directory.lookupByHost("a.localhost");
    await directory.lookupByHost("b.localhost");
    directory.invalidate("A.localhost:3000");
    await directory.lookupByHost("a.localhost");
    await directory.lookupByHost("b.localhost");
    expect(load).toHaveBeenCalledTimes(3);
    directory.invalidate();
    await directory.lookupByHost("a.localhost");
    await directory.lookupByHost("b.localhost");
    expect(load).toHaveBeenCalledTimes(5);
  });

  it("does not ask the loader for something that is not a host", async () => {
    const load = vi.fn(async () => entry);
    const directory = cachedDirectory(load);
    expect(await directory.lookupByHost("no es un host!")).toBeUndefined();
    expect(load).not.toHaveBeenCalled();
  });
});

describe("staticDirectory", () => {
  it("serves its entries as active businesses and nobody else", async () => {
    const directory = staticDirectory({
      "a.localhost": { id: "a", databaseUrl: "postgresql://a" },
    });
    expect(await directory.lookupByHost("A.localhost:3000")).toEqual({
      state: "active",
      tenant: { id: "a", databaseUrl: "postgresql://a" },
    });
    expect(await directory.lookupByHost("b.localhost")).toBeUndefined();
  });
});

describe("entryFromRecord — subscriptions", () => {
  const NOW = new Date("2026-11-10T12:00:00.000Z");
  const withNow: RecordDeps = { ...deps, now: () => NOW };
  const day = (offset: number) => new Date(NOW.getTime() + offset * 24 * 60 * 60 * 1000);
  const subscription = (periodEndOffsetDays: number, overrides = {}) => ({
    isTrial: false,
    currentPeriodEnd: day(periodEndOffsetDays),
    graceDays: 7,
    readOnlyDays: 60,
    plan: {
      name: "Básico",
      features: ["customers", "reports", "no-existe"],
      limits: { users: 3, products: null, extra: 9 },
    },
    ...overrides,
  });

  it("a business without a subscription carries no entitlements (it is not restricted)", () => {
    const entry = entryFromRecord(record({ subscription: null }), withNow);
    expect(entry).toMatchObject({ state: "active" });
    expect(entry && "tenant" in entry && "entitlements" in entry.tenant).toBe(false);
  });

  it("carries the plan, keeping only the modules and limits that exist", () => {
    const entry = entryFromRecord(record({ subscription: subscription(10) }), withNow);
    expect(entry).toMatchObject({
      state: "active",
      tenant: {
        entitlements: {
          planName: "Básico",
          features: ["customers", "reports"],
          limits: { users: 3, products: null },
          mode: "full",
          status: "ACTIVE",
          daysToPeriodEnd: 10,
        },
      },
    });
  });

  it("marks a trial as such until it is paid", () => {
    const entry = entryFromRecord(
      record({ subscription: subscription(3, { isTrial: true }) }),
      withNow,
    );
    expect(entry).toMatchObject({ tenant: { entitlements: { status: "TRIAL", mode: "full" } } });
  });

  it("after the due date there are grace days with everything working, then read-only", () => {
    expect(entryFromRecord(record({ subscription: subscription(-3) }), withNow)).toMatchObject({
      state: "active",
      tenant: { entitlements: { mode: "grace" } },
    });
    expect(entryFromRecord(record({ subscription: subscription(-20) }), withNow)).toMatchObject({
      state: "active",
      tenant: { entitlements: { mode: "readonly" } },
    });
  });

  it("a cancelled subscription is shown as suspended for billing, without opening the credential", () => {
    const entry = entryFromRecord(
      record({ subscription: subscription(-100), dbCredentialEnc: "basura" }),
      withNow,
    );
    expect(entry).toEqual({
      state: "suspended",
      reason: "billing",
      tenant: { id: "ten1", slug: "tienda-a", name: "Tienda A" },
    });
  });

  it("a subscription never revives a business that is suspended or serves nobody", () => {
    expect(
      entryFromRecord(record({ status: "SUSPENDED", subscription: subscription(10) }), withNow),
    ).toEqual({
      state: "suspended",
      tenant: { id: "ten1", slug: "tienda-a", name: "Tienda A" },
    });
    expect(
      entryFromRecord(record({ status: "DELETED", subscription: subscription(10) }), withNow),
    ).toBeUndefined();
  });
});
