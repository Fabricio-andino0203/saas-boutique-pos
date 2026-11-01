import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import {
  createTemplateDatabase,
  createTenantDatabase,
  dropDatabase,
  dropTenantDatabase,
  urlFor,
  withClient,
  type ProvisionedDatabase,
} from "@/lib/tenancy/provision-db";
import { setTenantDirectory } from "@/lib/tenancy/control-directory";
import { staticDirectory } from "@/lib/tenancy/directory";
import { resolveCurrentTenant } from "@/lib/tenancy/resolver";
import {
  closeAllTenantClients,
  configureTenantPool,
  tenantPoolStats,
} from "@/lib/tenancy/tenant-clients";
import {
  runWithTenant,
  setProcessDefaultTenant,
  TenantContextError,
  type TenantRef,
} from "@/lib/tenancy/tenant-context";
import { hashSessionToken } from "@/modules/auth/token";
import { findSession } from "@/modules/auth/service";
import { openCashSession } from "@/modules/cash/service";
import { recordMovement } from "@/modules/inventory/service";
import { verifyBooks } from "@/modules/ops/verify-books";
import { completeSale } from "@/modules/sales/service";

/**
 * Etapa 0 de la propuesta SaaS: dos (y tres) negocios con **los mismos identificadores** en bases distintas, todo accedido a
 * través del `db` único de la aplicación. Si algo de esto se mezclara, el sistema no podría usarse como SaaS.
 */

const adminUrl = process.env.DATABASE_URL_TEST as string;
const TEMPLATE = "poc_template";

type Business = { ref: TenantRef; db: ProvisionedDatabase; label: string; token: string };
const businesses: Record<"a" | "b" | "c", Business> = {} as never;

const future = () => new Date(Date.now() + 3_600_000);

/** Datos idénticos en identificadores (`prod-same`, `user-same`…) y distintos en contenido. Se siembra con la cuenta de aprovisionamiento. */
async function seedSameIds(business: Business): Promise<void> {
  await withClient(urlFor(adminUrl, { database: business.db.database }), async (client) => {
    await client.category.create({ data: { id: "cat-same", name: "Mujer", slug: "mujer" } });
    await client.product.create({
      data: {
        id: "prod-same",
        code: "P-1",
        name: `Vestido ${business.label}`,
        categoryId: "cat-same",
        basePriceCents: 11500,
      },
    });
    await client.user.create({
      data: {
        id: "user-same",
        name: `Dueño ${business.label}`,
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
  });
}

beforeAll(async () => {
  vi.stubEnv("TENANCY_MODE", "multi");
  // Esta prueba comprueba justamente que NO hay negocio por defecto.
  setProcessDefaultTenant(undefined);
  await createTemplateDatabase(adminUrl, TEMPLATE);
  for (const key of ["a", "b", "c"] as const) {
    const id = `poc_${key}`;
    await dropTenantDatabase(adminUrl, id);
    const provisioned = await createTenantDatabase(adminUrl, { id, template: TEMPLATE });
    businesses[key] = {
      ref: { id, databaseUrl: provisioned.appUrl },
      db: provisioned,
      label: key.toUpperCase(),
      token: `token-del-negocio-${key}`,
    };
    await seedSameIds(businesses[key]);
  }
  setTenantDirectory(
    staticDirectory({
      "a.localhost": businesses.a.ref,
      "b.localhost": businesses.b.ref,
    }),
  );
}, 180_000);

afterAll(async () => {
  await closeAllTenantClients();
  setTenantDirectory(undefined);
  vi.unstubAllEnvs();
  for (const key of ["a", "b", "c"] as const) {
    await dropTenantDatabase(adminUrl, `poc_${key}`);
  }
  await dropDatabase(adminUrl, TEMPLATE);
}, 60_000);

describe("the resolver fails closed", () => {
  it("refuses every kind of call when there is no business in context", async () => {
    await expect(db.user.findMany()).rejects.toBeInstanceOf(TenantContextError);
    await expect(db.$queryRaw`select 1`).rejects.toBeInstanceOf(TenantContextError);
    await expect(db.$transaction(async () => 1)).rejects.toBeInstanceOf(TenantContextError);
    await expect(resolveCurrentTenant()).rejects.toBeInstanceOf(TenantContextError);
  });

  it("cannot be called like a function or awaited as a thenable", async () => {
    expect(() => (db as unknown as () => void)()).toThrow(TypeError);
    expect(await Promise.resolve(db)).toBe(db);
  });
});

describe("two businesses with the same identifiers", () => {
  it("each sees only its own rows", async () => {
    for (const key of ["a", "b", "c"] as const) {
      const business = businesses[key];
      const product = await runWithTenant(business.ref, () =>
        db.product.findUniqueOrThrow({ where: { id: "prod-same" } }),
      );
      expect(product.name).toBe(`Vestido ${business.label}`);
      const user = await runWithTenant(business.ref, () =>
        db.user.findUniqueOrThrow({ where: { id: "user-same" } }),
      );
      expect(user.name).toBe(`Dueño ${business.label}`);
    }
  });

  it("a session of one business does not exist in the other", async () => {
    const { a, b } = businesses;
    expect(await runWithTenant(a.ref, () => findSession(a.token))).toMatchObject({
      user: { id: "user-same" },
    });
    expect(await runWithTenant(b.ref, () => findSession(a.token))).toBeNull();
    expect(await runWithTenant(a.ref, () => findSession(b.token))).toBeNull();
    expect(await runWithTenant(b.ref, () => findSession(b.token))).toMatchObject({
      user: { id: "user-same" },
    });
  });

  it("raw SQL and transactions run in the right database", async () => {
    const names = await Promise.all(
      (["a", "b", "c"] as const).map((key) =>
        runWithTenant(businesses[key].ref, async () => {
          const [row] = await db.$queryRaw<{ name: string }[]>`select current_database() as name`;
          const inTransaction = await db.$transaction(async (tx) => {
            const [inner] = await tx.$queryRaw<
              { name: string }[]
            >`select current_database() as name`;
            return inner?.name;
          });
          return [row?.name, inTransaction];
        }),
      ),
    );
    expect(names).toEqual([
      [businesses.a.db.database, businesses.a.db.database],
      [businesses.b.db.database, businesses.b.db.database],
      [businesses.c.db.database, businesses.c.db.database],
    ]);
  });

  it("stays separate under 300 interleaved concurrent operations", async () => {
    const keys = ["a", "b", "c"] as const;
    const assigned = Array.from(
      { length: 300 },
      (_, index) => keys[(index * 7 + (index % 5)) % 3] as "a" | "b" | "c",
    );
    await Promise.all(
      assigned.map((key, index) =>
        runWithTenant(businesses[key].ref, async () => {
          await new Promise((resolve) => setTimeout(resolve, (index * 13) % 17));
          const [row] = await db.$queryRaw<{ name: string }[]>`select current_database() as name`;
          expect(row?.name).toBe(businesses[key].db.database);
          await db.customer.create({ data: { name: `cliente-${key}-${index}` } });
        }),
      ),
    );
    for (const key of keys) {
      const expected = assigned.filter((assignedKey) => assignedKey === key).length;
      const found = await runWithTenant(businesses[key].ref, () =>
        db.customer.findMany({
          where: { name: { startsWith: "cliente-" } },
          select: { name: true },
        }),
      );
      expect(found).toHaveLength(expected);
      expect(found.every((customer) => customer.name.startsWith(`cliente-${key}-`))).toBe(true);
    }
  });
});

describe("database-level isolation", () => {
  it("a business role cannot even connect to another business database", async () => {
    const { a, b } = businesses;
    const crossed = urlFor(adminUrl, {
      database: b.db.database,
      user: a.db.role,
      password: a.db.password,
    });
    await expect(withClient(crossed, (client) => client.$queryRaw`select 1`)).rejects.toThrow();
  });

  it("the application role can read and write data but cannot change the schema", async () => {
    const { a } = businesses;
    await withClient(a.db.appUrl, async (client) => {
      await expect(client.product.count()).resolves.toBeGreaterThan(0);
      await expect(client.$executeRawUnsafe("CREATE TABLE intruso (i int)")).rejects.toThrow();
      await expect(client.$executeRawUnsafe('DROP TABLE "Product"')).rejects.toThrow();
      await expect(
        client.$executeRawUnsafe('ALTER TABLE "Product" ADD COLUMN x int'),
      ).rejects.toThrow();
    });
  });

  it("each business role has its own connection limit and statement timeout", async () => {
    const [row] = await withClient(
      urlFor(adminUrl, { database: "postgres" }),
      (admin) =>
        admin.$queryRaw<{ rolconnlimit: number; rolconfig: string[] }[]>`
        select rolconnlimit, rolconfig from pg_roles where rolname = ${businesses.a.db.role}
      `,
    );
    expect(row?.rolconnlimit).toBe(10);
    expect(row?.rolconfig).toContain("statement_timeout=60s");
  });
});

describe("the connection pool manager", () => {
  it("closes the least recently used business when too many are open, and reopens it on demand", async () => {
    await closeAllTenantClients();
    configureTenantPool({ maxActive: 2, poolSize: 2, idleMs: 3_600_000 });
    const before = tenantPoolStats();
    for (const key of ["a", "b", "c", "a", "b", "c"] as const) {
      const [row] = await runWithTenant(
        businesses[key].ref,
        () => db.$queryRaw<{ name: string }[]>`select current_database() as name`,
      );
      expect(row?.name).toBe(businesses[key].db.database);
      expect(tenantPoolStats().active).toBeLessThanOrEqual(2);
    }
    const after = tenantPoolStats();
    expect(after.evicted - before.evicted).toBeGreaterThanOrEqual(4);
    expect(after.created - before.created).toBe(6);
  });

  it("never closes a business that has an operation in flight", async () => {
    await closeAllTenantClients();
    configureTenantPool({ maxActive: 1, poolSize: 2, idleMs: 3_600_000 });
    const slow = runWithTenant(businesses.a.ref, () =>
      db.$transaction(async (tx) => {
        await tx.$executeRaw`select pg_sleep(1)`;
        const [row] = await tx.$queryRaw<{ name: string }[]>`select current_database() as name`;
        return row?.name;
      }),
    );
    // Mientras la transacción de A sigue abierta, B pide lugar con tope 1: A no se cierra a la mitad.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const [other] = await runWithTenant(
      businesses.b.ref,
      () => db.$queryRaw<{ name: string }[]>`select current_database() as name`,
    );
    expect(other?.name).toBe(businesses.b.db.database);
    await expect(slow).resolves.toBe(businesses.a.db.database);
    configureTenantPool({ maxActive: 50, poolSize: 3, idleMs: 300_000 });
  });
});

describe("the real sales engine under two businesses with the same ids", () => {
  async function openBusiness(business: Business) {
    return runWithTenant(business.ref, async () => {
      const location = await db.location.create({
        data: { code: "MAIN", name: "Tienda principal", isDefault: true },
      });
      await db.terminal.create({ data: { name: "Caja 1", locationId: location.id } });
      const variant = await db.variant.create({
        data: { productId: "prod-same", sku: "P-1-M", barcode: "BC-P1-M", avgCostCents: 4000 },
      });
      await db.$transaction((tx) =>
        recordMovement(tx, {
          variantId: variant.id,
          locationId: location.id,
          userId: "user-same",
          type: "INITIAL",
          quantity: 5,
        }),
      );
      const owner = { id: "user-same", role: "OWNER" as const };
      await openCashSession(owner, { openingFloatCents: 10_000 });
      return { owner, variantId: variant.id };
    });
  }

  it("sells in both at the same time, with the same request id, numbering each from T-000001", async () => {
    const [worldA, worldB] = await Promise.all([
      openBusiness(businesses.a),
      openBusiness(businesses.b),
    ]);
    const input = (variantId: string) => ({
      clientRequestId: "solicitud-repetida-001",
      lines: [{ variantId, quantity: 2 }],
      payments: [{ method: "CASH", amountCents: 23_000 }],
    });
    const [saleA, saleB] = await Promise.all([
      runWithTenant(businesses.a.ref, () => completeSale(worldA.owner, input(worldA.variantId))),
      runWithTenant(businesses.b.ref, () => completeSale(worldB.owner, input(worldB.variantId))),
    ]);
    expect(saleA).toMatchObject({ number: "T-000001", totalCents: 23_000, replayed: false });
    expect(saleB).toMatchObject({ number: "T-000001", totalCents: 23_000, replayed: false });
    expect(saleA.id).not.toBe(saleB.id);

    // Repetir la solicitud en A devuelve la misma venta; en B no hay nada extra
    const again = await runWithTenant(businesses.a.ref, () =>
      completeSale(worldA.owner, input(worldA.variantId)),
    );
    expect(again).toMatchObject({ id: saleA.id, replayed: true });
    for (const key of ["a", "b"] as const) {
      expect(await runWithTenant(businesses[key].ref, () => db.sale.count())).toBe(1);
      const stock = await runWithTenant(businesses[key].ref, () =>
        db.stockLevel.findFirstOrThrow(),
      );
      expect(stock.onHand).toBe(3);
    }
  });

  it("leaves the books of each business balanced", async () => {
    for (const key of ["a", "b"] as const) {
      const report = await runWithTenant(businesses[key].ref, () => verifyBooks(db));
      expect(report.problems).toEqual([]);
      expect(report.summary.sales).toBe(1);
    }
  });
});
