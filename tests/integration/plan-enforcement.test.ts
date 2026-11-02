import { AsyncLocalStorage } from "node:async_hooks";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createFileStore } from "@/lib/blob-store";
import { db } from "@/lib/db";
import { currentEntitlements, requireFeature } from "@/lib/entitlements";
import { FeatureNotIncludedError, PlanLimitError, ReadOnlyAccountError } from "@/lib/errors";
import { createControlDirectory, setTenantDirectory } from "@/lib/tenancy/control-directory";
import type { TenantDirectory } from "@/lib/tenancy/directory";
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
import { resolveCurrentTenant } from "@/lib/tenancy/resolver";
import { closeAllTenantClients } from "@/lib/tenancy/tenant-clients";
import { setProcessDefaultTenant, TenantContextError } from "@/lib/tenancy/tenant-context";
import { getVault, setVault, vaultContext } from "@/lib/tenancy/vault";
import { findSession, login, revokeSession } from "@/modules/auth/service";
import {
  assignPlan,
  changePlan,
  createPlan,
  registerPayment,
  updatePlan,
} from "@/modules/platform/billing";
import {
  createProduct,
  duplicateProduct,
  listProducts,
  setProductArchived,
} from "@/modules/products/service";
import { addProductPhoto, removeProductPhoto } from "@/modules/photos/service";
import { createFirstOwner } from "@/modules/users/bootstrap";
import { createUser, listUsers, setUserActive } from "@/modules/users/service";
import {
  closeControlTestDatabase,
  controlTestDb,
  resetControlDatabase,
} from "./helpers/control-db";

/**
 * Etapa 4: lo que el plan de un negocio le deja hacer, comprobado de punta a punta — el host busca el negocio en la base
 * central, el directorio trae su plan, y las acciones de la aplicación (que usan `db`, sin saber nada de planes) respetan los
 * límites, los módulos y el solo lectura. Cada "petición" lleva el host del negocio, como en el servidor.
 */

const adminUrl = process.env.DATABASE_URL_TEST as string;
const TEMPLATE = "pe_template";
const BASE_DOMAIN = "localhost";
const HOST = `tienda.${BASE_DOMAIN}`;
const DAY = 24 * 60 * 60 * 1000;
const PASSWORD = "Clave-segura-123";
const context = { actor: { id: "admin-1", username: "admin-prueba" }, ip: "10.0.0.1" };

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

const asRequest = <T>(fn: () => Promise<T>, host = HOST): Promise<T> =>
  requestStore.run({ host }, fn);

let provisioned: ProvisionedDatabase;
let directory: TenantDirectory;
let owner: { id: string; role: "OWNER" };
let categoryId: string;
const slug = "tienda";

async function planOf(overrides: Record<string, unknown> = {}): Promise<string> {
  return (
    await createPlan(
      {
        name: `Plan ${Math.random().toString(36).slice(2, 8)}`,
        description: null,
        priceCents: 90_000,
        interval: "MONTHLY",
        limits: { users: null, products: null, terminals: null, locations: null },
        features: ["reports", "customers"],
        trialDays: 14,
        sortOrder: 1,
        ...overrides,
      },
      context,
      { client: controlTestDb },
    )
  ).id;
}

/** Le pone al negocio un plan ya vigente que vence en `endsInDays` (negativo = ya venció). */
async function subscribe(planId: string, endsInDays: number): Promise<void> {
  await assignPlan(
    {
      slug,
      planId,
      trial: false,
      periodEnd: new Date(Date.now() + 30 * DAY),
      reason: "Prueba",
    },
    context,
    { client: controlTestDb },
  );
  await setPeriodEnd(endsInDays);
}

async function setPeriodEnd(endsInDays: number): Promise<void> {
  await controlTestDb.subscription.updateMany({
    where: { tenant: { slug }, status: { not: "EXPIRED" } },
    data: {
      currentPeriodStart: new Date(Date.now() - 400 * DAY),
      currentPeriodEnd: new Date(Date.now() + endsInDays * DAY),
    },
  });
}

let counter = 0;
const newUser = () => {
  counter += 1;
  return {
    name: `Cajero ${counter}`,
    username: `cajero${counter}`,
    role: "CASHIER" as const,
    password: PASSWORD,
  };
};
const newProduct = () => {
  counter += 1;
  return {
    name: `Vestido ${counter}`,
    code: `V${counter}`,
    categoryId,
    basePriceCents: 100_000,
    baseCostCents: 40_000,
  };
};

beforeAll(async () => {
  vi.stubEnv("TENANCY_MODE", "multi");
  setProcessDefaultTenant(undefined);
  setVault(undefined);
  await resetControlDatabase();
  await createTemplateDatabase(adminUrl, TEMPLATE);
  await dropTenantDatabase(adminUrl, "pe_a");
  provisioned = await createTenantDatabase(adminUrl, { id: "pe_a", template: TEMPLATE });
  await withClient(urlFor(adminUrl, { database: provisioned.database }), async (client) => {
    const created = await createFirstOwner(
      { name: "Dueña", username: "duena", password: PASSWORD },
      client,
    );
    owner = { id: created.id, role: "OWNER" };
    categoryId = (await client.category.create({ data: { name: "Mujer", slug: "mujer" } })).id;
    await client.location.create({ data: { code: "MAIN", name: "Tienda", isDefault: true } });
  });
  await controlTestDb.tenant.create({
    data: {
      id: "pe_a",
      slug,
      name: "Tienda de prueba",
      status: "ACTIVE",
      dbServerId: "primary",
      dbName: provisioned.database,
      dbRole: provisioned.role,
      dbCredentialEnc: getVault().encrypt(
        provisioned.password,
        vaultContext.tenantDatabase("pe_a"),
      ),
    },
  });
  directory = createControlDirectory({ baseDomain: BASE_DOMAIN, ttlMs: 0 });
  setTenantDirectory(directory);
}, 240_000);

beforeEach(async () => {
  // Cada prueba empieza sin plan, con solo la dueña y ningún producto. TRUNCATE no dispara el trigger de solo inserción.
  await controlTestDb.$executeRawUnsafe(
    `TRUNCATE TABLE "PlatformPayment", "Subscription" RESTART IDENTITY CASCADE`,
  );
  await withClient(urlFor(adminUrl, { database: provisioned.database }), async (client) => {
    await client.$executeRawUnsafe(
      `TRUNCATE TABLE "AuditLog", "Session", "PriceHistory", "StockMovement", "StockLevel", "Variant", "Product" RESTART IDENTITY CASCADE`,
    );
    await client.user.deleteMany({ where: { id: { not: owner.id } } });
  });
});

afterAll(async () => {
  await closeAllTenantClients();
  setTenantDirectory(undefined);
  vi.unstubAllEnvs();
  await dropTenantDatabase(adminUrl, "pe_a");
  await dropDatabase(adminUrl, TEMPLATE);
  await resetControlDatabase();
  await closeControlTestDatabase();
}, 60_000);

describe("a business without a plan", () => {
  it("is not restricted in any way", async () => {
    await asRequest(async () => {
      expect(await currentEntitlements()).toBeUndefined();
      await createUser(owner, newUser());
      await createProduct(owner, newProduct());
      await expect(requireFeature("layaways")).resolves.toBeUndefined();
    });
  });
});

describe("limits", () => {
  it("lets the business create up to its user limit and then refuses, counting only active users", async () => {
    await subscribe(
      await planOf({ limits: { users: 2, products: null, terminals: null, locations: null } }),
      20,
    );
    await asRequest(async () => {
      const second = await createUser(owner, newUser()); // la dueña + 1 = 2
      const error = await createUser(owner, newUser()).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(PlanLimitError);
      expect(error).toMatchObject({ kind: "users", limit: 2 });
      expect((await listUsers()).length).toBe(2);

      // Archivar a alguien libera un lugar; volver a activarlo con el plan lleno no se puede.
      await setUserActive(owner, second.id, false);
      const third = await createUser(owner, newUser());
      await expect(setUserActive(owner, second.id, true)).rejects.toBeInstanceOf(PlanLimitError);
      await setUserActive(owner, third.id, false);
      await setUserActive(owner, second.id, true);
    });
  });

  it("limits the products the same way, including restoring and duplicating", async () => {
    await subscribe(
      await planOf({ limits: { users: null, products: 1, terminals: null, locations: null } }),
      20,
    );
    await asRequest(async () => {
      const first = await createProduct(owner, newProduct());
      await expect(createProduct(owner, newProduct())).rejects.toBeInstanceOf(PlanLimitError);
      await expect(duplicateProduct(owner, first.id)).rejects.toBeInstanceOf(PlanLimitError);

      await setProductArchived(owner, first.id, true);
      const second = await createProduct(owner, newProduct());
      await expect(setProductArchived(owner, first.id, false)).rejects.toBeInstanceOf(
        PlanLimitError,
      );
      expect((await listProducts({ status: "all", page: 1 })).total).toBe(2);
      expect(second.id).not.toBe(first.id);
    });
  });

  it("limits the product photos of the whole business, and removing one frees a place", async () => {
    await subscribe(
      await planOf({
        limits: { users: null, products: null, terminals: null, locations: null, photos: 2 },
      }),
      20,
    );
    const folder = await mkdtemp(path.join(tmpdir(), "plan-photos-"));
    const deps = { store: createFileStore(folder), folder: "pe_a" };
    const data = await sharp({
      create: { width: 40, height: 40, channels: 3, background: "#aa5500" },
    })
      .jpeg()
      .toBuffer();
    try {
      await asRequest(async () => {
        const dress = await createProduct(owner, newProduct());
        const blouse = await createProduct(owner, newProduct());
        const first = await addProductPhoto(owner, dress.id, { data }, deps);
        await addProductPhoto(owner, blouse.id, { data }, deps); // 2 en total, en productos distintos

        const error = await addProductPhoto(owner, dress.id, { data }, deps).catch(
          (caught: unknown) => caught,
        );
        expect(error).toBeInstanceOf(PlanLimitError);
        expect(error).toMatchObject({ kind: "photos", limit: 2 });

        await removeProductPhoto(owner, first.id, deps);
        await addProductPhoto(owner, dress.id, { data }, deps);
      });
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  it("moving to a smaller plan deletes nothing: it only stops the business from adding more", async () => {
    const roomy = await planOf({
      name: "Amplio",
      limits: { users: 10, products: null, terminals: null, locations: null },
    });
    const tight = await planOf({
      name: "Estrecho",
      limits: { users: 1, products: null, terminals: null, locations: null },
    });
    await subscribe(roomy, 20);
    await asRequest(async () => {
      await createUser(owner, newUser());
      await createUser(owner, newUser());
      await changePlan({ slug, planId: tight, when: "now", reason: "Bajó de plan" }, context, {
        client: controlTestDb,
      });
      expect((await listUsers()).length).toBe(3);
      await expect(createUser(owner, newUser())).rejects.toBeInstanceOf(PlanLimitError);
      expect((await listUsers()).filter((user) => user.isActive).length).toBe(3);
    });
  });
});

describe("modules", () => {
  it("refuses a module the plan does not include, and starts allowing it when the plan gets it", async () => {
    const planId = await planOf({ features: ["customers"] });
    await subscribe(planId, 20);
    await asRequest(async () => {
      await expect(requireFeature("reports")).rejects.toBeInstanceOf(FeatureNotIncludedError);
      await expect(requireFeature("customers")).resolves.toBeUndefined();
    });
    await updatePlan(
      planId,
      {
        name: (await controlTestDb.plan.findUniqueOrThrow({ where: { id: planId } })).name,
        description: null,
        priceCents: 90_000,
        interval: "MONTHLY",
        limits: { users: null, products: null, terminals: null, locations: null },
        features: ["customers", "reports"],
        trialDays: 14,
        sortOrder: 1,
      },
      context,
      { client: controlTestDb },
    );
    await asRequest(async () => {
      await expect(requireFeature("reports")).resolves.toBeUndefined();
    });
  });
});

describe("grace, read-only and cancelled", () => {
  it("in grace everything still works", async () => {
    await subscribe(await planOf(), -3);
    await asRequest(async () => {
      expect((await currentEntitlements())?.mode).toBe("grace");
      await createUser(owner, newUser());
      await createProduct(owner, newProduct());
    });
  });

  it("in read-only the business can look and export but cannot record anything new", async () => {
    await subscribe(await planOf(), -20);
    await asRequest(async () => {
      expect((await currentEntitlements())?.mode).toBe("readonly");
      await expect(createUser(owner, newUser())).rejects.toBeInstanceOf(ReadOnlyAccountError);
      await expect(createProduct(owner, newProduct())).rejects.toBeInstanceOf(ReadOnlyAccountError);
      await expect(listUsers()).resolves.toHaveLength(1);
      await expect(listProducts({ page: 1 })).resolves.toMatchObject({ total: 0 });
      await expect(db.$queryRaw`select 1 as ok`).resolves.toEqual([{ ok: 1 }]);
    });
    // Nada llegó a la base.
    await withClient(urlFor(adminUrl, { database: provisioned.database }), async (client) => {
      expect(await client.user.count()).toBe(1);
      expect(await client.product.count()).toBe(0);
    });
  });

  it("in read-only people can still sign in, keep their session and sign out", async () => {
    await subscribe(await planOf(), -20);
    await asRequest(async () => {
      const result = await login({ username: "duena", password: PASSWORD });
      expect(await findSession(result.token)).toMatchObject({ user: { id: owner.id } });
      await revokeSession(result.token);
      expect(await findSession(result.token)).toBeNull();
    });
  });

  it("a payment lifts the read-only at once", async () => {
    await subscribe(await planOf(), -20);
    await asRequest(async () => {
      await expect(createUser(owner, newUser())).rejects.toBeInstanceOf(ReadOnlyAccountError);
    });
    await registerPayment({ slug, amountCents: 90_000, method: "CASH" }, context, {
      client: controlTestDb,
    });
    await asRequest(async () => {
      expect((await currentEntitlements())?.mode).toBe("full");
      await expect(createUser(owner, newUser())).resolves.toBeDefined();
    });
  });

  it("a cancelled business is not served at all: not resolved, and its host is 'expired'", async () => {
    await subscribe(await planOf(), -100);
    await asRequest(async () => {
      await expect(resolveCurrentTenant()).rejects.toBeInstanceOf(TenantContextError);
      await expect(listUsers()).rejects.toBeInstanceOf(TenantContextError);
    });
    expect(
      await classifyHost(HOST, { mode: "multi", platformHost: "admin.localhost", directory }),
    ).toBe("expired");
    await registerPayment({ slug, amountCents: 90_000, method: "CASH" }, context, {
      client: controlTestDb,
    });
    expect(
      await classifyHost(HOST, { mode: "multi", platformHost: "admin.localhost", directory }),
    ).toBe("tenant");
  });
});
