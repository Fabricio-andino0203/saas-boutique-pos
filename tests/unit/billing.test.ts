import { describe, expect, it } from "vitest";

import {
  CAPABILITY_FEATURE,
  FEATURE_PATHS,
  featureForPath,
  isPlanFeature,
  PLAN_FEATURES,
} from "@/config/plan-catalog";
import { CAPABILITIES } from "@/lib/permissions";
import {
  addDays,
  addMonths,
  BILLING_POLICY,
  computeBillingPosition,
  includesFeature,
  limitOf,
  parseLimits,
  toEntitlements,
  type SubscriptionTiming,
} from "@/lib/tenancy/billing";

const end = new Date("2026-11-30T05:59:59.999Z"); // 23:59:59 hora de Honduras
const sub = (overrides: Partial<SubscriptionTiming> = {}): SubscriptionTiming => ({
  isTrial: false,
  currentPeriodEnd: end,
  graceDays: 7,
  readOnlyDays: 60,
  ...overrides,
});
const at = (offsetMs: number) => new Date(end.getTime() + offsetMs);
const DAY = 24 * 60 * 60 * 1000;

describe("computeBillingPosition — the four stages of a subscription", () => {
  it("everything works until the end of the paid period, to the millisecond", () => {
    expect(computeBillingPosition(sub(), at(-30 * DAY))).toMatchObject({
      status: "ACTIVE",
      mode: "full",
    });
    expect(computeBillingPosition(sub(), at(0))).toMatchObject({ status: "ACTIVE", mode: "full" });
    expect(computeBillingPosition(sub(), at(1))).toMatchObject({
      status: "PAST_DUE",
      mode: "grace",
    });
  });

  it("a trial is a trial while it lasts and then follows the same road", () => {
    expect(computeBillingPosition(sub({ isTrial: true }), at(-DAY)).status).toBe("TRIAL");
    expect(computeBillingPosition(sub({ isTrial: true }), at(DAY)).status).toBe("PAST_DUE");
  });

  it("the grace days keep everything working, with a warning", () => {
    expect(computeBillingPosition(sub(), at(7 * DAY))).toMatchObject({
      status: "PAST_DUE",
      mode: "grace",
    });
    expect(computeBillingPosition(sub(), at(7 * DAY + 1))).toMatchObject({
      status: "SUSPENDED",
      mode: "readonly",
    });
  });

  it("then it is read-only for the read-only days, and then blocked", () => {
    expect(computeBillingPosition(sub(), at(67 * DAY))).toMatchObject({
      status: "SUSPENDED",
      mode: "readonly",
    });
    expect(computeBillingPosition(sub(), at(67 * DAY + 1))).toMatchObject({
      status: "CANCELLED",
      mode: "blocked",
    });
    expect(computeBillingPosition(sub(), at(400 * DAY)).mode).toBe("blocked");
  });

  it("respects the days agreed for each subscription", () => {
    const strict = sub({ graceDays: 0, readOnlyDays: 0 });
    expect(computeBillingPosition(strict, at(1)).mode).toBe("blocked");
    const generous = sub({ graceDays: 30, readOnlyDays: 90 });
    expect(computeBillingPosition(generous, at(29 * DAY)).mode).toBe("grace");
    expect(computeBillingPosition(generous, at(31 * DAY)).mode).toBe("readonly");
    expect(computeBillingPosition(generous, at(121 * DAY)).mode).toBe("blocked");
  });

  it("reports the dates that matter and the days left", () => {
    const position = computeBillingPosition(sub(), at(-3 * DAY - 1000));
    expect(position.daysToPeriodEnd).toBe(3);
    expect(position.graceEndsAt).toEqual(addDays(end, 7));
    expect(position.readOnlyEndsAt).toEqual(addDays(end, 67));
    expect(computeBillingPosition(sub(), at(2 * DAY)).daysToPeriodEnd).toBe(-2);
  });

  it("the platform defaults match the agreed policy", () => {
    expect(BILLING_POLICY).toEqual({ graceDays: 7, readOnlyDays: 60, trialDays: 14 });
  });
});

describe("addMonths", () => {
  it("adds calendar months without overflowing the month", () => {
    expect(addMonths(new Date("2026-01-31T12:00:00Z"), 1).toISOString()).toBe(
      "2026-02-28T12:00:00.000Z",
    );
    expect(addMonths(new Date("2028-01-31T12:00:00Z"), 1).toISOString()).toBe(
      "2028-02-29T12:00:00.000Z",
    );
    expect(addMonths(new Date("2026-11-15T00:00:00Z"), 3).toISOString()).toBe(
      "2027-02-15T00:00:00.000Z",
    );
    expect(addMonths(new Date("2026-03-31T00:00:00Z"), 12).toISOString()).toBe(
      "2027-03-31T00:00:00.000Z",
    );
    expect(addMonths(new Date("2026-08-31T00:00:00Z"), 6).toISOString()).toBe(
      "2027-02-28T00:00:00.000Z",
    );
  });
});

describe("what the plan includes", () => {
  it("keeps only the limits it understands", () => {
    expect(
      parseLimits({ users: 5, products: null, terminals: -1, locations: 1.5, extra: 3 }),
    ).toEqual({
      users: 5,
      products: null,
    });
    expect(parseLimits(null)).toEqual({});
    expect(parseLimits("5")).toEqual({});
  });

  it("builds the entitlements from a plan and the time, dropping unknown modules", () => {
    const entitlements = toEntitlements(
      {
        ...sub(),
        planName: "Básico",
        features: ["reports", "no-existe", "layaways"],
        limits: { users: 3 },
      },
      at(-DAY),
      PLAN_FEATURES,
    );
    expect(entitlements).toMatchObject({
      planName: "Básico",
      features: ["reports", "layaways"],
      limits: { users: 3 },
      mode: "full",
      status: "ACTIVE",
    });
    expect(entitlements.periodEnd).toBe(end.toISOString());
  });

  it("without a plan nothing is restricted", () => {
    expect(includesFeature(undefined, "reports")).toBe(true);
    expect(limitOf(undefined, "users")).toBeNull();
  });

  it("with a plan only its modules are included, and an unset limit is unlimited", () => {
    const entitlements = toEntitlements(
      { ...sub(), planName: "Mínimo", features: ["reports"], limits: { users: 2 } },
      at(0),
      PLAN_FEATURES,
    );
    expect(includesFeature(entitlements, "reports")).toBe(true);
    expect(includesFeature(entitlements, "layaways")).toBe(false);
    expect(limitOf(entitlements, "users")).toBe(2);
    expect(limitOf(entitlements, "products")).toBeNull();
  });
});

describe("the module catalog", () => {
  it("maps screens to their module, and the core to nothing", () => {
    expect(featureForPath("/reportes")).toBe("reports");
    expect(featureForPath("/reportes/ventas")).toBe("reports");
    expect(featureForPath("/api/reportes/ventas/exportar")).toBe("reports");
    expect(featureForPath("/apartados/abc")).toBe("layaways");
    expect(featureForPath("/compras/recepciones/nueva")).toBe("purchasing");
    expect(featureForPath("/catalogos/suppliers")).toBe("purchasing");
    expect(featureForPath("/inventario/conteos/xyz")).toBe("stockCounts");
    expect(featureForPath("/inventario/etiquetas/plantilla")).toBe("labels");
    expect(featureForPath("/configuracion/cai")).toBe("fiscal");
    expect(featureForPath("/clientes/nuevo")).toBe("customers");
    // El núcleo siempre está.
    for (const core of [
      "/",
      "/vender",
      "/ventas",
      "/caja",
      "/inventario",
      "/productos",
      "/usuarios",
      "/configuracion",
      "/login",
      "/cuenta",
      "/catalogos/brands",
    ]) {
      expect(featureForPath(core), core).toBeUndefined();
    }
  });

  it("does not match a lookalike prefix", () => {
    expect(featureForPath("/reportesx")).toBeUndefined();
    expect(featureForPath("/apartadosecreto")).toBeUndefined();
    expect(featureForPath("/inventario/conteos-viejos")).toBeUndefined();
  });

  it("every module has screens, every gated capability exists and every module is known", () => {
    for (const feature of PLAN_FEATURES) {
      expect(FEATURE_PATHS[feature].length, feature).toBeGreaterThan(0);
      expect(isPlanFeature(feature)).toBe(true);
    }
    for (const [capability, feature] of Object.entries(CAPABILITY_FEATURE)) {
      expect(CAPABILITIES as readonly string[], capability).toContain(capability);
      expect(isPlanFeature(feature)).toBe(true);
    }
    expect(isPlanFeature("sale")).toBe(false);
  });
});
