/**
 * URL de la base CENTRAL de pruebas (plataforma). `vitest.config.ts` la deriva de `DATABASE_URL_TEST` cuando no se define
 * `CONTROL_DATABASE_URL_TEST` (`boutique_pos_test` → `boutique_pos_control_test`). Siempre debe terminar en `_test`.
 */
export function controlTestUrl(): string {
  const url = process.env.CONTROL_DATABASE_URL_TEST;
  if (!url) {
    throw new Error("CONTROL_DATABASE_URL_TEST no está definida (revisa .env y vitest.config.ts).");
  }
  const databaseName = new URL(url).pathname.replace(/^\//, "");
  if (!databaseName.endsWith("_test")) {
    throw new Error(
      `La base central de pruebas debe terminar en _test (recibida: ${databaseName}).`,
    );
  }
  return url;
}

/** Llave maestra fija de las pruebas (32 bytes), igual a la que fija `vitest.config.ts`. No protege nada real. */
export const TEST_MASTER_KEY = Buffer.alloc(32, 7).toString("base64url");
