import "@/lib/env"; // valida el entorno al cargar, como antes
import { createTenantResolver } from "@/lib/tenancy/resolver";

/**
 * Acceso a datos de toda la aplicación. Solo los `service` y `queries` de cada módulo deben importarlo; las páginas y
 * componentes nunca llaman a la BD directamente.
 *
 * Ya no es un cliente fijo: es un objeto que **elige la base del negocio actual en cada llamada** (ver
 * `src/lib/tenancy/resolver.ts`). En el modo `single` (por omisión) sigue usando `DATABASE_URL`, como siempre.
 */
export const db = createTenantResolver();
