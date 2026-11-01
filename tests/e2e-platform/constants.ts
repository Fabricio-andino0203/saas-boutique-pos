/** Contraseña del administrador de prueba (solo existe en la base central de pruebas). */
export const E2E_PASSWORD = "contrasena-de-prueba-larga";

/** Puerto del servidor de las pruebas de la plataforma (ver playwright.platform.config.ts). */
export const PLATFORM_E2E_PORT = 3200;

/**
 * Dos negocios de prueba con **el mismo usuario y la misma contraseña** y datos distintos (el nombre del negocio). Se crean
 * en `setup-tenants.ts` y viven en bases propias (`t_e2e_a`, `t_e2e_b`) que se borran al terminar.
 */
export const TENANTS = {
  a: { id: "e2e_a", slug: "e2e-a", name: "Boutique A" },
  b: { id: "e2e_b", slug: "e2e-b", name: "Boutique B" },
} as const;

export const OWNER_USERNAME = "dueno";

/** Base «dorada» de las pruebas: de ella se copian los negocios que se dan de alta desde el panel. */
export const E2E_TEMPLATE_DB = "e2e_template";

/**
 * Dos negocios ya dados de baja, con su base archivada en el servidor: uno sin volcado final (se le pide desde el panel) y otro
 * con un volcado final bueno ya anotado (se borra desde el panel). Ids parecidos a los reales: sin guiones bajos.
 */
export const RETIRED = {
  pending: { id: "e2eretiredb", slug: "e2e-retirada", database: "z_archived_e2eretiredb" },
  dumped: { id: "e2edumpedb", slug: "e2e-volcada", database: "z_archived_e2edumpedb" },
} as const;
