import { AsyncLocalStorage } from "node:async_hooks";

import type { TenantEntitlements } from "@/lib/tenancy/billing";

/**
 * Un negocio (tenant) tal como lo necesita el acceso a datos: quién es y a qué base conectarse. La URL se arma con la
 * credencial que la bóveda descifra de la base central (ver `control-directory.ts`).
 */
export type TenantRef = {
  id: string;
  databaseUrl: string;
  /** Subdominio del negocio. Solo para el registro y la lectura humana: nunca decide a qué base se conecta nadie. */
  slug?: string;
  /**
   * Lo que el plan del negocio le permite (módulos, límites y si está en gracia o en solo lectura). Lo llena el directorio de
   * hosts para atender una petición; ausente = sin restricciones (una sola tienda, procesos y negocios sin plan).
   */
  entitlements?: TenantEntitlements;
};

/** No hay negocio en contexto: el acceso a datos **falla cerrado** en vez de caer a una base "por defecto". */
export class TenantContextError extends Error {
  constructor(message = "No hay un negocio en el contexto de esta operación") {
    super(message);
    this.name = "TenantContextError";
  }
}

const globalContext = globalThis as typeof globalThis & {
  __boutiqueTenantContext?: AsyncLocalStorage<TenantRef>;
};

/**
 * Next puede empaquetar cada ruta por separado y duplicar los módulos: se guarda el almacenamiento en `globalThis` para que
 * todas las copias compartan el mismo contexto.
 */
function storage(): AsyncLocalStorage<TenantRef> {
  return (globalContext.__boutiqueTenantContext ??= new AsyncLocalStorage<TenantRef>());
}

/** Ejecuta `fn` (y todo lo asíncrono que nazca de ella) como el negocio indicado. Es la forma de trabajar de procesos y pruebas. */
export function runWithTenant<T>(tenant: TenantRef, fn: () => T): T {
  return storage().run(tenant, fn);
}

const globalDefault = globalThis as typeof globalThis & { __boutiqueDefaultTenant?: TenantRef };

/**
 * Negocio predeterminado de **todo el proceso**, para procesos y pruebas que atienden a un único negocio y no pueden envolver
 * cada operación en `runWithTenant` (p. ej. los ganchos de una suite de pruebas). Dentro de una petición web **nunca** se
 * usa: ahí manda el host o se falla. El código de la aplicación no debe llamar a esta función (lo vigila una prueba).
 */
export function setProcessDefaultTenant(tenant: TenantRef | undefined): void {
  globalDefault.__boutiqueDefaultTenant = tenant;
}

export function processDefaultTenant(): TenantRef | undefined {
  return globalDefault.__boutiqueDefaultTenant;
}

/** El negocio del contexto actual, si lo hay. */
export function tenantFromContext(): TenantRef | undefined {
  return storage().getStore();
}
