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
