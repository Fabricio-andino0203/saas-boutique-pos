import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CAPABILITY_FEATURE,
  FEATURE_PATHS,
  featureForPath,
  PLAN_FEATURES,
} from "@/config/plan-catalog";
import {
  assertWithinPlanLimit,
  capabilityInPlan,
  currentEntitlements,
  requireCapabilityInPlan,
  requireFeature,
} from "@/lib/entitlements";
import { FeatureNotIncludedError, PlanLimitError } from "@/lib/errors";
import { CAPABILITIES } from "@/lib/permissions";
import { toEntitlements, type TenantEntitlements } from "@/lib/tenancy/billing";
import { runWithTenant } from "@/lib/tenancy/tenant-context";

const NOW = new Date("2026-11-01T12:00:00.000Z");

function entitlements(overrides: Partial<TenantEntitlements> = {}): TenantEntitlements {
  return {
    ...toEntitlements(
      {
        isTrial: false,
        currentPeriodEnd: new Date("2026-12-01T12:00:00.000Z"),
        graceDays: 7,
        readOnlyDays: 60,
        planName: "Básico",
        features: ["customers", "reports"],
        limits: { users: 2, products: 3 },
      },
      NOW,
      PLAN_FEATURES,
    ),
    ...overrides,
  };
}

const inTenant = <T>(value: TenantEntitlements | undefined, fn: () => Promise<T>) =>
  runWithTenant({ id: "t1", databaseUrl: "postgresql://t1", entitlements: value }, fn);

beforeEach(() => {
  vi.stubEnv("TENANCY_MODE", "multi");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the plan catalog", () => {
  it("maps every capability that depends on a module to a module that exists", () => {
    for (const [capability, feature] of Object.entries(CAPABILITY_FEATURE)) {
      expect((CAPABILITIES as readonly string[]).includes(capability), capability).toBe(true);
      expect(PLAN_FEATURES, capability).toContain(feature);
    }
  });

  it("ties every Finance capability to the finance module, so a plan without it cannot use any of them", () => {
    for (const capability of ["finance.view", "finance.write", "finance.void"]) {
      expect(CAPABILITY_FEATURE[capability], capability).toBe("finance");
    }
  });

  it("gives every module at least one screen, and no screen belongs to two modules", () => {
    const seen = new Map<string, string>();
    for (const feature of PLAN_FEATURES) {
      expect(FEATURE_PATHS[feature].length, feature).toBeGreaterThan(0);
      for (const prefix of FEATURE_PATHS[feature]) {
        expect(seen.get(prefix), `${prefix} ya es de otro módulo`).toBeUndefined();
        seen.set(prefix, feature);
      }
    }
  });

  it("finds the module of a screen and of what it submits, and leaves the core alone", () => {
    expect(featureForPath("/reportes")).toBe("reports");
    expect(featureForPath("/reportes/ventas")).toBe("reports");
    expect(featureForPath("/api/reportes/ventas.csv")).toBe("reports");
    expect(featureForPath("/apartados/abc")).toBe("layaways");
    expect(featureForPath("/imprimir/apartado/abc")).toBe("layaways");
    expect(featureForPath("/inventario/etiquetas")).toBe("labels");
    expect(featureForPath("/inventario/conteos/nuevo")).toBe("stockCounts");
    expect(featureForPath("/catalogos/suppliers")).toBe("purchasing");
    for (const core of [
      "/",
      "/vender",
      "/ventas",
      "/caja",
      "/productos",
      "/inventario",
      "/usuarios",
    ]) {
      expect(featureForPath(core), core).toBeUndefined();
    }
  });

  it("does not confuse a longer name that merely starts the same", () => {
    expect(featureForPath("/reportesx")).toBeUndefined();
    expect(featureForPath("/apartados-viejos")).toBeUndefined();
    expect(featureForPath("/inventario/conteo")).toBeUndefined();
  });
});

describe("what the plan includes", () => {
  it("a business without a plan has no restrictions", async () => {
    await inTenant(undefined, async () => {
      expect(await currentEntitlements()).toBeUndefined();
      await expect(requireFeature("layaways")).resolves.toBeUndefined();
      await expect(requireCapabilityInPlan("layaway.manage")).resolves.toBeUndefined();
      await expect(assertWithinPlanLimit("users", async () => 999)).resolves.toBeUndefined();
    });
  });

  it("refuses a module the plan does not include, and allows one it does", async () => {
    await inTenant(entitlements(), async () => {
      await expect(requireFeature("reports")).resolves.toBeUndefined();
      const error = await requireFeature("layaways").catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(FeatureNotIncludedError);
      expect((error as FeatureNotIncludedError).feature).toBe("layaways");
    });
  });

  it("applies the module of a capability, and ignores capabilities of the core", async () => {
    await inTenant(entitlements(), async () => {
      await expect(requireCapabilityInPlan("report.view")).resolves.toBeUndefined();
      await expect(requireCapabilityInPlan("layaway.manage")).rejects.toBeInstanceOf(
        FeatureNotIncludedError,
      );
      await expect(requireCapabilityInPlan("sale.create")).resolves.toBeUndefined();
    });
    expect(capabilityInPlan(entitlements(), "return.create")).toBe(false);
    expect(capabilityInPlan(entitlements(), "sale.create")).toBe(true);
    expect(capabilityInPlan(undefined, "return.create")).toBe(true);
  });

  it("outside any business there is nothing to limit (the database would refuse anyway)", async () => {
    expect(await currentEntitlements()).toBeUndefined();
  });
});

describe("limits", () => {
  it("allows creating up to the limit and refuses the one that passes it", async () => {
    await inTenant(entitlements(), async () => {
      await expect(assertWithinPlanLimit("users", async () => 0)).resolves.toBeUndefined();
      await expect(assertWithinPlanLimit("users", async () => 1)).resolves.toBeUndefined();
      const error = await assertWithinPlanLimit("users", async () => 2).catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(PlanLimitError);
      expect(error).toMatchObject({ kind: "users", limit: 2 });
    });
  });

  it("counts a whole import at once: all of it fits or none of it does", async () => {
    await inTenant(entitlements(), async () => {
      await expect(assertWithinPlanLimit("products", async () => 1, 2)).resolves.toBeUndefined();
      await expect(assertWithinPlanLimit("products", async () => 1, 3)).rejects.toBeInstanceOf(
        PlanLimitError,
      );
    });
  });

  it("a business over its limit keeps its data and just cannot add more", async () => {
    await inTenant(entitlements(), async () => {
      await expect(assertWithinPlanLimit("users", async () => 8)).rejects.toBeInstanceOf(
        PlanLimitError,
      );
    });
  });

  it("does not even count when there is no limit", async () => {
    const used = vi.fn(async () => 1_000_000);
    await inTenant(entitlements({ limits: { users: null } }), async () => {
      await expect(assertWithinPlanLimit("users", used)).resolves.toBeUndefined();
      await expect(assertWithinPlanLimit("products", used)).resolves.toBeUndefined();
    });
    expect(used).not.toHaveBeenCalled();
  });

  it("a limit of zero means nothing can be added", async () => {
    await inTenant(entitlements({ limits: { products: 0 } }), async () => {
      await expect(assertWithinPlanLimit("products", async () => 0)).rejects.toBeInstanceOf(
        PlanLimitError,
      );
    });
  });
});
