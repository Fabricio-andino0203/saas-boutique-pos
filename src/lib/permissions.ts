import { ForbiddenError } from "@/lib/errors";

export const ROLES = ["OWNER", "MANAGER", "CASHIER", "WAREHOUSE"] as const;

export type Role = (typeof ROLES)[number];

export const CAPABILITIES = [
  "sale.create",
  "discount.apply",
  "discount.applyBeyondLimit",
  "sale.void",
  "return.create",
  "return.refundCash",
  "return.overridePolicy",
  "customer.view",
  "customer.write",
  "customer.archive",
  "credit.adjust",
  "layaway.manage",
  "layaway.cancel",
  "cash.open",
  "cash.closeApprove",
  "cash.viewOthers",
  "product.write",
  "product.viewCost",
  "price.change",
  "stock.adjust",
  "stock.approveCount",
  "purchase.receive",
  "report.view",
  "report.financial",
  "finance.view",
  "finance.write",
  "finance.void",
  "user.manage",
  "settings.manage",
  "audit.view",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const MANAGER_CAPABILITIES: readonly Capability[] = CAPABILITIES.filter(
  (capability) =>
    capability !== "user.manage" && capability !== "settings.manage" && capability !== "audit.view",
);

export const ROLE_CAPABILITIES: Record<Role, ReadonlySet<Capability>> = {
  OWNER: new Set<Capability>(CAPABILITIES),
  MANAGER: new Set<Capability>(MANAGER_CAPABILITIES),
  CASHIER: new Set<Capability>([
    "sale.create",
    "discount.apply",
    "return.create",
    "customer.view",
    "customer.write",
    "report.view",
    "layaway.manage",
    "cash.open",
  ]),
  WAREHOUSE: new Set<Capability>(["product.write", "stock.adjust", "purchase.receive"]), // cuenta, pero no aprueba conteos
};

export const MANAGER_PIN_OVERRIDES = [
  "discount.applyBeyondLimit",
  "sale.void",
  "return.refundCash",
  "return.overridePolicy",
  "layaway.cancel",
] as const satisfies readonly Capability[];

export function hasCapability(role: Role, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role].has(capability);
}

export function requireCapability(actor: { role: Role }, capability: Capability): void {
  if (!hasCapability(actor.role, capability)) {
    throw new ForbiddenError(`Role ${actor.role} lacks capability ${capability}`);
  }
}

export function canManagerPinOverride(capability: Capability): boolean {
  return (MANAGER_PIN_OVERRIDES as readonly Capability[]).includes(capability);
}
