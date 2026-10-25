import { describe, expect, it } from "vitest";

import { ForbiddenError } from "@/lib/errors";
import { Role as PrismaRole } from "@/generated/prisma/enums";
import {
  CAPABILITIES,
  MANAGER_PIN_OVERRIDES,
  ROLES,
  ROLE_CAPABILITIES,
  canManagerPinOverride,
  hasCapability,
  requireCapability,
  type Capability,
  type Role,
} from "@/lib/permissions";

// [capacidad, OWNER, MANAGER, CASHIER, WAREHOUSE] derivado fila por fila de docs/PRD.md §2
const matrix: ReadonlyArray<readonly [Capability, boolean, boolean, boolean, boolean]> = [
  ["sale.create", true, true, true, false],
  ["discount.apply", true, true, true, false],
  ["discount.applyBeyondLimit", true, true, false, false],
  ["sale.void", true, true, false, false],
  ["return.create", true, true, true, false],
  ["cash.open", true, true, true, false],
  ["cash.closeApprove", true, true, false, false],
  ["cash.viewOthers", true, true, false, false],
  ["product.write", true, true, false, true],
  ["product.viewCost", true, true, false, false],
  ["price.change", true, true, false, false],
  ["stock.adjust", true, true, false, true],
  ["purchase.receive", true, true, false, true],
  ["report.financial", true, true, false, false],
  ["user.manage", true, false, false, false],
  ["settings.manage", true, false, false, false],
  ["audit.view", true, false, false, false],
];

const roleOrder: readonly Role[] = ["OWNER", "MANAGER", "CASHIER", "WAREHOUSE"];

describe("capability matrix", () => {
  it("covers exactly the declared capabilities", () => {
    expect(new Set(matrix.map((row) => row[0]))).toEqual(new Set(CAPABILITIES));
  });

  it.each(matrix)("%s per role", (capability, ...expected) => {
    roleOrder.forEach((role, index) => {
      expect(hasCapability(role, capability), `${role} · ${capability}`).toBe(expected[index]);
    });
  });

  it("keeps ROLE_CAPABILITIES in sync with hasCapability", () => {
    for (const role of ROLES) {
      expect(ROLE_CAPABILITIES[role].size).toBe(
        matrix.filter((row) => row[1 + roleOrder.indexOf(role)]).length,
      );
    }
  });
});

describe("requireCapability", () => {
  it("throws ForbiddenError when the role lacks the capability", () => {
    expect(() => requireCapability({ role: "CASHIER" }, "product.viewCost")).toThrow(
      ForbiddenError,
    );
  });

  it("does not throw when the role has it", () => {
    expect(() => requireCapability({ role: "OWNER" }, "user.manage")).not.toThrow();
    expect(() => requireCapability({ role: "WAREHOUSE" }, "stock.adjust")).not.toThrow();
  });
});

describe("manager PIN overrides", () => {
  it("lists the two overridable capabilities, held by manager and owner but not the cashier", () => {
    expect([...MANAGER_PIN_OVERRIDES].sort()).toEqual(["discount.applyBeyondLimit", "sale.void"]);
    for (const capability of MANAGER_PIN_OVERRIDES) {
      expect(hasCapability("MANAGER", capability)).toBe(true);
      expect(hasCapability("OWNER", capability)).toBe(true);
      expect(hasCapability("CASHIER", capability)).toBe(false);
    }
  });

  it("canManagerPinOverride is true only for those", () => {
    expect(canManagerPinOverride("discount.applyBeyondLimit")).toBe(true);
    expect(canManagerPinOverride("sale.void")).toBe(true);
    expect(canManagerPinOverride("product.viewCost")).toBe(false);
  });
});

describe("types and roles", () => {
  it("ROLES matches the Prisma Role enum", () => {
    expect([...ROLES].sort()).toEqual(Object.values(PrismaRole).sort());
  });

  it("rejects unknown capabilities at type level and at runtime", () => {
    // @ts-expect-error capacidad inexistente
    expect(hasCapability("OWNER", "capacidad.inexistente")).toBe(false);
  });
});
