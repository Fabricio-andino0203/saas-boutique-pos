import { assertIdentifier, urlFor, withClient } from "@/lib/tenancy/provision-db";

/**
 * La parte de Postgres de PgBouncer (docs/RUNBOOK.md §17). PgBouncer no conoce de antemano a los roles de los negocios: cada vez
 * que alguien se conecta le pregunta a Postgres por su contraseña llamando a `pgbouncer.get_auth()`, con una cuenta propia
 * (`pgbouncer`) que **solo** puede ejecutar esa función. La función devuelve el verificador de contraseña de un rol de negocio
 * (nunca el de una cuenta con superpoderes), y la cuenta no puede leer ni una tabla.
 */

const SECRET = /^[A-Za-z0-9]{16,128}$/;

export const PGBOUNCER_USER = "pgbouncer";
export const PGBOUNCER_SCHEMA = "pgbouncer";

/**
 * Crea (o pone al día) la cuenta de consulta de PgBouncer y su función. Se puede repetir: es lo que se corre después de cambiar
 * la contraseña. Necesita la cuenta de aprovisionamiento (puede crear roles y leer `pg_shadow`).
 */
export async function ensurePgbouncerAuth(
  adminUrl: string,
  options: { password: string; user?: string },
): Promise<void> {
  const user = assertIdentifier(options.user ?? PGBOUNCER_USER);
  if (!SECRET.test(options.password)) {
    throw new Error(
      "La contraseña de PgBouncer debe tener entre 16 y 128 letras y números (sin símbolos): pnpm platform:gen-key no sirve, usa «openssl rand -hex 24».",
    );
  }
  await withClient(urlFor(adminUrl, { database: "postgres" }), async (admin) => {
    const existing = await admin.$queryRaw<{ present: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${user}) AS present
    `;
    if (existing[0]?.present) {
      await admin.$executeRawUnsafe(
        `ALTER ROLE "${user}" WITH LOGIN PASSWORD '${options.password}'`,
      );
    } else {
      await admin.$executeRawUnsafe(
        `CREATE ROLE "${user}" LOGIN PASSWORD '${options.password}' NOSUPERUSER NOCREATEDB NOCREATEROLE CONNECTION LIMIT 20`,
      );
    }
    await admin.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS ${PGBOUNCER_SCHEMA}`);
    // SECURITY DEFINER: corre con los permisos de quien la creó (la cuenta de aprovisionamiento) para leer `pg_shadow`.
    // Solo devuelve roles que no son superusuarios: el verificador de la cuenta principal de Postgres no sale por aquí.
    await admin.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION ${PGBOUNCER_SCHEMA}.get_auth(p_usename TEXT)
      RETURNS TABLE (usename NAME, passwd TEXT)
      LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
        SELECT s.usename, s.passwd::TEXT FROM pg_catalog.pg_shadow s
        WHERE s.usename = p_usename AND NOT s.usesuper
      $$
    `);
    await admin.$executeRawUnsafe(
      `REVOKE ALL ON FUNCTION ${PGBOUNCER_SCHEMA}.get_auth(TEXT) FROM PUBLIC`,
    );
    await admin.$executeRawUnsafe(`GRANT USAGE ON SCHEMA ${PGBOUNCER_SCHEMA} TO "${user}"`);
    await admin.$executeRawUnsafe(
      `GRANT EXECUTE ON FUNCTION ${PGBOUNCER_SCHEMA}.get_auth(TEXT) TO "${user}"`,
    );
  });
}
