import { CAPABILITY_FEATURE, type PlanFeature, type PlanLimitKind } from "@/config/plan-catalog";
import { FeatureNotIncludedError, PlanLimitError } from "@/lib/errors";
import type { Capability } from "@/lib/permissions";
import { includesFeature, limitOf, type TenantEntitlements } from "@/lib/tenancy/billing";
import { resolveCurrentTenant } from "@/lib/tenancy/resolver";
import { TenantContextError } from "@/lib/tenancy/tenant-context";

/**
 * Lo que el plan del negocio actual le permite (propuesta SaaS §5), visto desde la aplicación del negocio. Un negocio **sin
 * suscripción** (la instalación de una sola tienda, los procesos de fondo y los negocios anteriores a los planes) no tiene
 * restricciones: aquí todo devuelve «sí».
 *
 * Las reglas de fondo no viven aquí: el estado (gracia, solo lectura, bloqueado) lo decide `tenancy/billing.ts`, las pantallas
 * de cada módulo las corta `proxy.ts`, y las escrituras en solo lectura las corta el `db` (`tenancy/read-only-guard.ts`). Este
 * archivo cubre lo que ninguno de esos ve: las **acciones** de un módulo que no se compró y los **límites** al crear.
 */

/** Los derechos del negocio de esta operación, o `undefined` si no tiene plan (o no hay negocio en contexto: no hay nada que limitar). */
export async function currentEntitlements(): Promise<TenantEntitlements | undefined> {
  try {
    return (await resolveCurrentTenant()).entitlements;
  } catch (error) {
    if (error instanceof TenantContextError) {
      return undefined;
    }
    throw error;
  }
}

/** Lanza si el plan no incluye el módulo. */
export async function requireFeature(feature: PlanFeature): Promise<void> {
  if (!includesFeature(await currentEntitlements(), feature)) {
    throw new FeatureNotIncludedError(feature);
  }
}

function featureOfCapability(capability: Capability): PlanFeature | undefined {
  const feature: PlanFeature | undefined = CAPABILITY_FEATURE[capability];
  return feature;
}

/** ¿La capacidad pertenece a un módulo que el plan incluye (o no pertenece a ningún módulo)? Sirve también para esconder opciones. */
export function capabilityInPlan(
  entitlements: TenantEntitlements | undefined,
  capability: Capability,
): boolean {
  const feature = featureOfCapability(capability);
  return feature === undefined || includesFeature(entitlements, feature);
}

/** Lanza si la capacidad pertenece a un módulo que el plan no incluye. */
export async function requireCapabilityInPlan(capability: Capability): Promise<void> {
  const feature = featureOfCapability(capability);
  if (feature) {
    await requireFeature(feature);
  }
}

/**
 * Antes de crear algo que cuenta para un límite del plan: si el plan tiene tope y crear `adding` más lo pasaría, lanza
 * `PlanLimitError`. `used` cuenta lo que ya hay y solo se ejecuta cuando existe un tope (sin plan o sin tope no se consulta nada).
 *
 * Un plan con menos tope que el uso actual (8 usuarios en un plan de 5) **no borra nada**: solo impide crear más.
 */
export async function assertWithinPlanLimit(
  kind: PlanLimitKind,
  used: () => Promise<number>,
  adding = 1,
): Promise<void> {
  const limit = limitOf(await currentEntitlements(), kind);
  if (limit === null) {
    return;
  }
  if ((await used()) + adding > limit) {
    throw new PlanLimitError(kind, limit);
  }
}
