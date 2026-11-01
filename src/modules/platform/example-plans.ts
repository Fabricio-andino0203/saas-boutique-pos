import { PLAN_FEATURES } from "@/config/plan-catalog";
import { controlDb } from "@/lib/tenancy/control-db";
import { createPlan, type BillingDeps, type PlanInput } from "@/modules/platform/billing";
import type { AdminContext } from "@/modules/platform/service";

/**
 * Tres planes para empezar (ajústalos a tus precios desde el panel). Se crean solo cuando se piden, y solo los que no existan
 * ya por nombre: pedirlos de nuevo no duplica ni pisa los que ya cambiaste.
 */
export const EXAMPLE_PLANS: readonly PlanInput[] = [
  {
    name: "Básico",
    description: "Para una tienda que empieza: vender, cobrar, caja, inventario y clientes.",
    priceCents: 50_000,
    interval: "MONTHLY",
    limits: { users: 3, products: 500, terminals: null, locations: null },
    features: ["customers"],
    trialDays: 14,
    backupRetentionDays: 30,
    sortOrder: 10,
  },
  {
    name: "Estándar",
    description: "Suma reportes, devoluciones, apartados y etiquetas.",
    priceCents: 90_000,
    interval: "MONTHLY",
    limits: { users: 8, products: 3000, terminals: null, locations: null },
    features: ["customers", "reports", "returns", "layaways", "labels"],
    trialDays: 14,
    backupRetentionDays: 60,
    sortOrder: 20,
  },
  {
    name: "Completo",
    description: "Todos los módulos y sin límites de usuarios ni de productos.",
    priceCents: 150_000,
    interval: "MONTHLY",
    limits: { users: null, products: null, terminals: null, locations: null },
    features: [...PLAN_FEATURES],
    trialDays: 14,
    backupRetentionDays: 90,
    sortOrder: 30,
  },
];

/** Crea los planes de ejemplo que falten. Devuelve los nombres de los que creó. */
export async function seedExamplePlans(
  context: AdminContext,
  deps: BillingDeps = {},
): Promise<string[]> {
  const client = deps.client ?? controlDb;
  const existing = new Set(
    (await client.plan.findMany({ select: { name: true } })).map((plan) => plan.name),
  );
  const created: string[] = [];
  for (const plan of EXAMPLE_PLANS) {
    if (!existing.has(plan.name)) {
      await createPlan(plan, context, deps);
      created.push(plan.name);
    }
  }
  return created;
}
