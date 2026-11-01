import { AsyncLocalStorage } from "node:async_hooks";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { createControlDirectory, setTenantDirectory } from "@/lib/tenancy/control-directory";
import { TenantDirectoryError, type TenantDirectory } from "@/lib/tenancy/directory";
import { classifyHost } from "@/lib/tenancy/host";
import {
  createTemplateDatabase,
  createTenantDatabase,
  dropDatabase,
  dropTenantDatabase,
  urlFor,
  withClient,
  type ProvisionedDatabase,
} from "@/lib/tenancy/provision-db";
import { currentTenantLabel, resolveCurrentTenant } from "@/lib/tenancy/resolver";
import { closeAllTenantClients } from "@/lib/tenancy/tenant-clients";
import { setProcessDefaultTenant, TenantContextError } from "@/lib/tenancy/tenant-context";
import { isCertificateAllowed } from "@/lib/tenancy/tls";
import { getVault, setVault, vaultContext } from "@/lib/tenancy/vault";
import { findSession } from "@/modules/auth/service";
import { hashSessionToken } from "@/modules/auth/token";
import { adoptExistingStore, readSchemaVersion, setTenantStatus } from "@/modules/platform/tenants";
import {
  closeControlTestDatabase,
  controlTestDb,
  resetControlDatabase,
} from "./helpers/control-db";

/**
 * Etapa 2 de la propuesta SaaS: el negocio de cada petición sale **solo** del host, buscado en la tabla Tenant de la base
 * central. Dos negocios con los mismos identificadores, una cuenta suspendida, hosts falsificados y credenciales cambiadas
 * de lugar: nada de eso debe mezclar datos ni abrir la base equivocada.
 */

const adminUrl = process.env.DATABASE_URL_TEST as string;
const TEMPLATE = "rt_template";
const BASE_DOMAIN = "localhost";

// `next/headers` solo existe dentro de una petición de Next. Aquí cada "petición" es una ejecución bajo `asRequest`, que
// guarda sus cabeceras en un AsyncLocalStorage (así 200 peticiones simultáneas no se pisan, como pasa en el servidor).
type RequestHeaders = Record<string, string>;
const requestStore = new AsyncLocalStorage<RequestHeaders>();
(globalThis as { __testRequestStore?: AsyncLocalStorage<RequestHeaders> }).__testRequestStore =
  requestStore;
vi.mock("next/headers", () => ({
  headers: async () => {
    const store = (globalThis as { __testRequestStore?: AsyncLocalStorage<RequestHeaders> })
      .__testRequestStore;
    const current = store?.getStore();
    if (!current) {
      throw new Error("headers() se llamó fuera de una petición");
    }
    return new Headers(current);
  },
}));

function asRequest<T>(host: string, fn: () => Promise<T>, extra: RequestHeaders = {}): Promise<T> {
  return requestStore.run({ host, ...extra }, fn);
}

type Business = { slug: string; id: string; provisioned: ProvisionedDatabase; token: string };
const businesses: Record<"a" | "b", Business> = {} as never;

const future = () => new Date(Date.now() + 3_600_000);

async function seedSameIds(business: Business, label: string): Promise<void> {
  await withClient(
    urlFor(adminUrl, { database: business.provisioned.database }),
    async (client) => {
      await client.category.create({ data: { id: "cat-same", name: "Mujer", slug: "mujer" } });
      await client.product.create({
        data: {
          id: "prod-same",
          code: "P-1",
          name: `Vestido ${label}`,
          categoryId: "cat-same",
          basePriceCents: 11500,
        },
      });
      await client.user.create({
        data: {
          id: "user-same",
          name: `Dueño ${label}`,
          username: "dueno",
          passwordHash: "x",
          role: "OWNER",
        },
      });
      await client.session.create({
        data: {
          id: "sess-same",
          sessionToken: hashSessionToken(business.token),
          userId: "user-same",
          expires: future(),
        },
      });
    },
  );
}

async function register(key: "a" | "b"): Promise<void> {
  const id = `rt_${key}`;
  const provisioned = await createTenantDatabase(adminUrl, { id, template: TEMPLATE });
  businesses[key] = { slug: `tienda-${key}`, id, provisioned, token: `token-del-negocio-${key}` };
  await seedSameIds(businesses[key], key.toUpperCase());
  await controlTestDb.tenant.create({
    data: {
      id,
      slug: businesses[key].slug,
      name: `Tienda ${key.toUpperCase()}`,
      status: "ACTIVE",
      dbServerId: "primary",
      dbName: provisioned.database,
      dbRole: provisioned.role,
      dbCredentialEnc: getVault().encrypt(provisioned.password, vaultContext.tenantDatabase(id)),
    },
  });
}

const hostOf = (key: "a" | "b") => `${businesses[key].slug}.${BASE_DOMAIN}`;
let directory: TenantDirectory;

beforeAll(async () => {
  vi.stubEnv("TENANCY_MODE", "multi");
  setProcessDefaultTenant(undefined); // esta prueba comprueba justamente que NO hay negocio por defecto
  setVault(undefined); // la bóveda del entorno de pruebas
  await resetControlDatabase();
  await createTemplateDatabase(adminUrl, TEMPLATE);
  for (const key of ["a", "b"] as const) {
    await dropTenantDatabase(adminUrl, `rt_${key}`);
    await register(key);
  }
  // Sin caché: cada prueba ve el estado actual de la base central.
  directory = createControlDirectory({ baseDomain: BASE_DOMAIN, ttlMs: 0 });
  setTenantDirectory(directory);
}, 240_000);

afterAll(async () => {
  await closeAllTenantClients();
  setTenantDirectory(undefined);
  vi.unstubAllEnvs();
  for (const key of ["a", "b"] as const) {
    await dropTenantDatabase(adminUrl, `rt_${key}`);
  }
  await dropDatabase(adminUrl, TEMPLATE);
  await resetControlDatabase();
  await closeControlTestDatabase();
}, 60_000);

const productName = () =>
  db.product.findUniqueOrThrow({ where: { id: "prod-same" } }).then((product) => product.name);

describe("the business of a request comes from the host", () => {
  it("each host reaches its own database, even though every identifier is the same", async () => {
    expect(await asRequest(hostOf("a"), productName)).toBe("Vestido A");
    expect(await asRequest(hostOf("b"), productName)).toBe("Vestido B");
    expect(
      await asRequest(`${businesses.a.slug}.${BASE_DOMAIN}:3000`.toUpperCase(), productName),
    ).toBe("Vestido A");
  });

  it("nothing the browser sends can pick another business", async () => {
    const forged = {
      "x-forwarded-host": hostOf("b"),
      "x-tenant": businesses.b.id,
      "x-tenant-id": businesses.b.id,
      "x-original-host": hostOf("b"),
      forwarded: `host=${hostOf("b")}`,
    };
    expect(await asRequest(hostOf("a"), productName, forged)).toBe("Vestido A");
    expect(await asRequest(hostOf("b"), productName, forged)).toBe("Vestido B");
  });

  it("a session token of one business does not exist in the other", async () => {
    const { a, b } = businesses;
    expect(await asRequest(hostOf("a"), () => findSession(a.token))).toMatchObject({
      user: { id: "user-same" },
    });
    expect(await asRequest(hostOf("b"), () => findSession(a.token))).toBeNull();
    expect(await asRequest(hostOf("a"), () => findSession(b.token))).toBeNull();
  });

  it("stays separate under 200 simultaneous requests alternating between the two hosts", async () => {
    const results = await Promise.all(
      Array.from({ length: 200 }, (_, index) => {
        const key = index % 3 === 0 ? "b" : "a";
        return asRequest(hostOf(key), async () => {
          await new Promise((resolve) => setTimeout(resolve, (index * 7) % 13));
          const [row] = await db.$queryRaw<{ name: string }[]>`select current_database() as name`;
          const label = await currentTenantLabel();
          return { key, database: row?.name, label };
        });
      }),
    );
    for (const result of results) {
      expect(result.database).toBe(businesses[result.key as "a" | "b"].provisioned.database);
      expect(result.label).toBe(businesses[result.key as "a" | "b"].slug);
    }
  });

  it("names the business for the log and the login limiter", async () => {
    expect(await asRequest(hostOf("a"), currentTenantLabel)).toBe("tienda-a");
    expect(await asRequest("nadie.localhost", currentTenantLabel)).toBeUndefined();
  });
});

describe("what is not a business fails closed", () => {
  const hosts = [
    "nadie.localhost",
    "localhost",
    "127.0.0.1:3000",
    "admin.localhost",
    "tienda-a.evil.com",
    "tienda-a.localhost.evil.com",
    "x.tienda-a.localhost",
    "",
  ];

  it.each(hosts)("host %j gets no database", async (host) => {
    await expect(asRequest(host, productName)).rejects.toBeInstanceOf(TenantContextError);
    await expect(asRequest(host, resolveCurrentTenant)).rejects.toBeInstanceOf(TenantContextError);
  });

  it("outside a request, with no business in context, there is no database either", async () => {
    await expect(db.user.findMany()).rejects.toBeInstanceOf(TenantContextError);
  });

  it("the panel host is classified apart and never opens a business database", async () => {
    const config = { mode: "multi" as const, platformHost: "admin.localhost", directory };
    expect(await classifyHost("admin.localhost:3000", config)).toBe("platform");
    await expect(asRequest("admin.localhost", productName)).rejects.toBeInstanceOf(
      TenantContextError,
    );
  });
});

describe("the status of a business decides what its address does", () => {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it("suspending takes one business out of service and leaves the other alone; reactivating restores it", async () => {
    await setTenantStatus({ slug: businesses.a.slug, status: "SUSPENDED" }, { actor: null });
    await expect(asRequest(hostOf("a"), productName)).rejects.toBeInstanceOf(TenantContextError);
    expect(
      await classifyHost(hostOf("a"), { mode: "multi", platformHost: undefined, directory }),
    ).toBe("suspended");
    expect(await asRequest(hostOf("b"), productName)).toBe("Vestido B");

    await setTenantStatus({ slug: businesses.a.slug, status: "ACTIVE" }, { actor: null });
    expect(await asRequest(hostOf("a"), productName)).toBe("Vestido A");

    const audit = await controlTestDb.platformAuditLog.findMany({
      where: { tenantId: businesses.a.id },
      orderBy: { at: "asc" },
    });
    expect(audit.map((row) => row.action)).toEqual(["TENANT_SUSPENDED", "TENANT_REACTIVATED"]);
    expect(audit[0]?.details).toMatchObject({ slug: "tienda-a", from: "ACTIVE", to: "SUSPENDED" });
  });

  it.each([
    ["PROVISIONING", undefined],
    ["FAILED", undefined],
    ["DELETED", undefined],
    ["PENDING_DELETION", "suspended"],
  ] as const)("a business in %s is %s", async (status, expected) => {
    // Una baja pendiente trae sus fechas (lo exige una restricción de la base central desde la Etapa 3).
    const pendingDeletion = {
      deletionRequestedAt: new Date(),
      deleteAfter: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      statusBeforeDeletion: "ACTIVE" as const,
    };
    await controlTestDb.tenant.update({
      where: { id: businesses.b.id },
      data: { status, ...(status === "PENDING_DELETION" ? pendingDeletion : {}) },
    });
    try {
      const entry = await directory.lookupByHost(hostOf("b"));
      expect(entry?.state).toBe(expected);
      await expect(asRequest(hostOf("b"), productName)).rejects.toBeInstanceOf(TenantContextError);
    } finally {
      await controlTestDb.tenant.update({
        where: { id: businesses.b.id },
        data: {
          status: "ACTIVE",
          deletionRequestedAt: null,
          deleteAfter: null,
          statusBeforeDeletion: null,
        },
      });
    }
  });

  it("only an active business can be suspended and only a suspended one reactivated", async () => {
    await controlTestDb.tenant.update({
      where: { id: businesses.b.id },
      data: { status: "PROVISIONING" },
    });
    try {
      await expect(
        setTenantStatus({ slug: businesses.b.slug, status: "SUSPENDED" }, { actor: null }),
      ).rejects.toBeInstanceOf(ConflictError);
    } finally {
      await controlTestDb.tenant.update({
        where: { id: businesses.b.id },
        data: { status: "ACTIVE" },
      });
    }
    // repetir lo mismo no falla ni duplica la auditoría
    const before = await controlTestDb.platformAuditLog.count({
      where: { tenantId: businesses.b.id },
    });
    await setTenantStatus({ slug: businesses.b.slug, status: "ACTIVE" }, { actor: null });
    expect(
      await controlTestDb.platformAuditLog.count({ where: { tenantId: businesses.b.id } }),
    ).toBe(before);
    await expect(
      setTenantStatus({ slug: "no-existe", status: "SUSPENDED" }, { actor: null }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("a short cache delays a suspension by at most its lifetime — and the cache can be told to forget", async () => {
    const cached = createControlDirectory({ baseDomain: BASE_DOMAIN, ttlMs: 400 });
    expect((await cached.lookupByHost(hostOf("a")))?.state).toBe("active");
    await controlTestDb.tenant.update({
      where: { id: businesses.a.id },
      data: { status: "SUSPENDED" },
    });
    try {
      expect((await cached.lookupByHost(hostOf("a")))?.state).toBe("active"); // aún en caché
      cached.invalidate(hostOf("a"));
      expect((await cached.lookupByHost(hostOf("a")))?.state).toBe("suspended");
      await controlTestDb.tenant.update({
        where: { id: businesses.a.id },
        data: { status: "ACTIVE" },
      });
      await sleep(450);
      expect((await cached.lookupByHost(hostOf("a")))?.state).toBe("active"); // venció sola
    } finally {
      await controlTestDb.tenant.update({
        where: { id: businesses.a.id },
        data: { status: "ACTIVE" },
      });
    }
  });
});

describe("the credential vault protects the databases", () => {
  it("never stores the database password in the clear", async () => {
    const row = await controlTestDb.tenant.findUniqueOrThrow({ where: { id: businesses.a.id } });
    expect(row.dbCredentialEnc).toMatch(/^v1\./);
    expect(row.dbCredentialEnc).not.toContain(businesses.a.provisioned.password);
  });

  it("a credential copied from one business to another opens nothing (the context is bound to the row)", async () => {
    const a = await controlTestDb.tenant.findUniqueOrThrow({ where: { id: businesses.a.id } });
    const original = (
      await controlTestDb.tenant.findUniqueOrThrow({ where: { id: businesses.b.id } })
    ).dbCredentialEnc;
    await controlTestDb.tenant.update({
      where: { id: businesses.b.id },
      data: { dbCredentialEnc: a.dbCredentialEnc },
    });
    try {
      await expect(directory.lookupByHost(hostOf("b"))).rejects.toBeInstanceOf(
        TenantDirectoryError,
      );
      await expect(asRequest(hostOf("b"), productName)).rejects.toBeInstanceOf(
        TenantDirectoryError,
      );
      // y el otro negocio sigue intacto
      expect(await asRequest(hostOf("a"), productName)).toBe("Vestido A");
    } finally {
      await controlTestDb.tenant.update({
        where: { id: businesses.b.id },
        data: { dbCredentialEnc: original },
      });
    }
    expect(await asRequest(hostOf("b"), productName)).toBe("Vestido B");
  });

  it("a business in an unknown server fails instead of falling to another database", async () => {
    await controlTestDb.tenant.update({
      where: { id: businesses.b.id },
      data: { dbServerId: "segundo" },
    });
    try {
      await expect(asRequest(hostOf("b"), productName)).rejects.toBeInstanceOf(
        TenantDirectoryError,
      );
    } finally {
      await controlTestDb.tenant.update({
        where: { id: businesses.b.id },
        data: { dbServerId: "primary" },
      });
    }
  });
});

describe("Caddy's certificate question", () => {
  it("answers yes only for the panel and for businesses that exist", async () => {
    const config = { mode: "multi" as const, platformHost: "admin.localhost", directory };
    expect(await isCertificateAllowed("admin.localhost", config)).toBe(true);
    expect(await isCertificateAllowed(hostOf("a"), config)).toBe(true);
    expect(await isCertificateAllowed("nadie.localhost", config)).toBe(false);
    expect(await isCertificateAllowed("evil.com", config)).toBe(false);
    await setTenantStatus({ slug: businesses.a.slug, status: "SUSPENDED" }, { actor: null });
    expect(await isCertificateAllowed(hostOf("a"), config)).toBe(true); // necesita HTTPS para mostrar su aviso
    await setTenantStatus({ slug: businesses.a.slug, status: "ACTIVE" }, { actor: null });
  });
});

describe("registering the store that is already in use as business #1", () => {
  const liveUrl = process.env.DATABASE_URL as string;

  it("registers it without touching its data, seals its credential and audits it", async () => {
    const rowsBefore = await withClient(liveUrl, (client) => client.user.count());
    const adopted = await adoptExistingStore(
      {
        slug: "tienda",
        name: "Mi Boutique",
        ownerEmail: "dueno@example.com",
        databaseUrl: liveUrl,
      },
      { actor: null },
    );
    const latest = await readSchemaVersion(liveUrl);
    expect(adopted.schemaVersion).toBe(latest);
    expect(latest).toMatch(/^\d{14}_/);

    const row = await controlTestDb.tenant.findUniqueOrThrow({ where: { id: adopted.id } });
    expect(row).toMatchObject({
      slug: "tienda",
      name: "Mi Boutique",
      status: "ACTIVE",
      dbServerId: "primary",
      schemaVersion: latest,
    });
    const password = new URL(liveUrl).password;
    expect(row.dbCredentialEnc).not.toContain(password);
    expect(
      getVault().decrypt(row.dbCredentialEnc as string, vaultContext.tenantDatabase(row.id)),
    ).toBe(decodeURIComponent(password));
    expect(() =>
      getVault().decrypt(row.dbCredentialEnc as string, vaultContext.tenantDatabase("otro")),
    ).toThrow();

    const audit = await controlTestDb.platformAuditLog.findFirstOrThrow({
      where: { action: "TENANT_ADOPTED", tenantId: row.id },
    });
    expect(JSON.stringify(audit.details)).not.toContain(password);
    expect(await withClient(liveUrl, (client) => client.user.count())).toBe(rowsBefore);
  });

  it("then serves it at <slug>.<base> through the same request path as any business", async () => {
    const [row] = await asRequest(
      `tienda.${BASE_DOMAIN}`,
      () => db.$queryRaw<{ name: string }[]>`select current_database() as name`,
    );
    expect(row?.name).toBe(new URL(process.env.DATABASE_URL as string).pathname.slice(1));
  });

  it("does not register the same store twice, nor take a reserved or malformed subdomain", async () => {
    const attempt = (slug: string, databaseUrl = liveUrl) =>
      adoptExistingStore({ slug, name: "Otra", databaseUrl }, { actor: null });
    await expect(attempt("tienda")).rejects.toBeInstanceOf(ConflictError);
    await expect(attempt("otra-tienda")).rejects.toBeInstanceOf(ConflictError); // misma base
    await expect(attempt("admin")).rejects.toBeInstanceOf(ValidationError);
    await expect(attempt("Con Espacios")).rejects.toBeInstanceOf(ValidationError);
    await expect(attempt("-malo")).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses a database it cannot read or that is not from this system", async () => {
    // Otras bases (la de la suite ya está registrada): una con la contraseña equivocada y una sin migraciones de este sistema.
    const broken = urlFor(liveUrl, { database: "rt_base_ilegible", password: "contraseña-mala" });
    await expect(
      adoptExistingStore({ slug: "rota", name: "Rota", databaseUrl: broken }, { actor: null }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      adoptExistingStore(
        {
          slug: "vacia",
          name: "Vacía",
          databaseUrl: urlFor(liveUrl, { database: "rt_base_vacia" }),
        },
        { actor: null },
        { schemaVersionOf: async () => null },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await controlTestDb.tenant.count({ where: { slug: { in: ["rota", "vacia"] } } })).toBe(
      0,
    );
  });
});
