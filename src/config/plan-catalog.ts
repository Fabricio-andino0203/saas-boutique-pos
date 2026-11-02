/**
 * Qué se puede vender por separado en un plan (propuesta SaaS §5): **módulos** que se encienden o apagan y **límites** de
 * cuánto se puede crear. El núcleo (vender, cobrar, caja, inventario y catálogo) va siempre en todos los planes.
 *
 * Este archivo no depende de nada del servidor: lo usan el proxy (que corta las pantallas de un módulo que el plan no
 * incluye), el menú, las acciones y el panel de la plataforma, y todos deben ver exactamente lo mismo.
 */

export const PLAN_FEATURES = [
  "reports",
  "layaways",
  "returns",
  "purchasing",
  "stockCounts",
  "labels",
  "customers",
  "fiscal",
] as const;

export type PlanFeature = (typeof PLAN_FEATURES)[number];

/**
 * Lo que se cuenta para los límites. `terminals` y `locations` ya tienen su lugar en el plan; se aplicarán cuando existan
 * pantallas para crear cajas y sucursales. `photos` son todas las fotos de productos del negocio (sin tope hasta que el plan lo fije).
 */
export const PLAN_LIMIT_KINDS = ["users", "products", "terminals", "locations", "photos"] as const;

export type PlanLimitKind = (typeof PLAN_LIMIT_KINDS)[number];

/** Un límite ausente o `null` significa «sin límite». */
export type PlanLimits = Partial<Record<PlanLimitKind, number | null>>;

/**
 * Las pantallas (y las acciones que se disparan desde ellas) de cada módulo. Una dirección que empieza con alguno de estos
 * prefijos requiere que el plan incluya el módulo.
 */
export const FEATURE_PATHS: Record<PlanFeature, readonly string[]> = {
  reports: ["/reportes", "/api/reportes", "/imprimir/valoracion"],
  layaways: ["/apartados", "/imprimir/apartado"],
  returns: ["/devoluciones", "/imprimir/devolucion"],
  purchasing: ["/compras", "/catalogos/suppliers"],
  stockCounts: ["/inventario/conteos"],
  labels: ["/inventario/etiquetas"],
  customers: ["/clientes"],
  fiscal: ["/configuracion/cai"],
};

/** El módulo que exige cada capacidad, para las acciones que se invocan desde pantallas de otro lugar (p. ej. el punto de venta). */
export const CAPABILITY_FEATURE: Readonly<Record<string, PlanFeature>> = {
  "layaway.manage": "layaways",
  "layaway.cancel": "layaways",
  "return.create": "returns",
  "return.refundCash": "returns",
  "return.overridePolicy": "returns",
  "purchase.receive": "purchasing",
  "report.view": "reports",
  "report.financial": "reports",
  "stock.approveCount": "stockCounts",
  "credit.adjust": "customers",
};

/** El módulo al que pertenece una dirección, o `undefined` si es del núcleo (siempre incluido). */
export function featureForPath(pathname: string): PlanFeature | undefined {
  for (const feature of PLAN_FEATURES) {
    for (const prefix of FEATURE_PATHS[feature]) {
      if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
        return feature;
      }
    }
  }
  return undefined;
}

export function isPlanFeature(value: string): value is PlanFeature {
  return (PLAN_FEATURES as readonly string[]).includes(value);
}
