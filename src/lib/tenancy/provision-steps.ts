import { readdirSync } from "node:fs";
import { join } from "node:path";

import {
  assertIdentifier,
  createTemplateDatabase,
  migrateDatabase,
  urlFor,
  withClient,
} from "@/lib/tenancy/provision-db";

/**
 * Pasos de la receta de alta de un negocio, cada uno **idempotente**: repetirlo deja el mismo resultado, así que una receta
 * interrumpida (o un paso que falló) se puede retomar sin deshacer lo que ya estaba bien.
 *
 * Todo corre con la cuenta de aprovisionamiento (`TENANT_PROVISIONING_URL`), que puede crear roles y bases. La aplicación en
 * funcionamiento se conecta, en cambio, con el rol limitado de cada negocio (solo permisos de datos).
 */

const SECRET = /^[A-Za-z0-9]{16,128}$/;
/** Código de Postgres cuando la base plantilla tiene conexiones abiertas: se reintenta. */
const SOURCE_IN_USE = /being accessed by other users/i;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** La URL de una base concreta con la cuenta de aprovisionamiento. */
export function adminUrlFor(adminUrl: string, database: string): string {
  return urlFor(adminUrl, { database: assertIdentifier(database) });
}

const serverUrl = (adminUrl: string) => urlFor(adminUrl, { database: "postgres" });

export async function databaseExists(adminUrl: string, name: string): Promise<boolean> {
  return withClient(serverUrl(adminUrl), async (client) => {
    const rows = await client.$queryRaw<{ present: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = ${name}) AS present
    `;
    return Boolean(rows[0]?.present);
  });
}

export async function roleExists(adminUrl: string, name: string): Promise<boolean> {
  return withClient(serverUrl(adminUrl), async (client) => {
    const rows = await client.$queryRaw<{ present: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${name}) AS present
    `;
    return Boolean(rows[0]?.present);
  });
}

/** Crea el rol de aplicación del negocio o, si ya existe, le deja esta contraseña y estos límites. */
export async function ensureTenantRole(
  adminUrl: string,
  options: { role: string; password: string; connectionLimit?: number },
): Promise<void> {
  const role = assertIdentifier(options.role);
  if (!SECRET.test(options.password)) {
    throw new Error("Contraseña de rol inválida");
  }
  const limit = Math.trunc(options.connectionLimit ?? 10);
  const exists = await roleExists(adminUrl, role);
  await withClient(serverUrl(adminUrl), async (admin) => {
    await admin.$executeRawUnsafe(
      exists
        ? `ALTER ROLE "${role}" WITH LOGIN PASSWORD '${options.password}' CONNECTION LIMIT ${limit}`
        : `CREATE ROLE "${role}" LOGIN PASSWORD '${options.password}' CONNECTION LIMIT ${limit} NOSUPERUSER NOCREATEDB NOCREATEROLE`,
    );
    // Un negocio no puede dejar consultas eternas que acaparen el servidor.
    await admin.$executeRawUnsafe(`ALTER ROLE "${role}" SET statement_timeout = '60s'`);
  });
}

/**
 * Crea la base del negocio copiándola de la plantilla (milisegundos) si aún no existe, y la deja accesible **solo** para su
 * rol. Postgres no copia una plantilla con conexiones abiertas: se reintenta unos segundos (p. ej. si justo se está
 * refrescando la plantilla).
 */
export async function ensureTenantDatabase(
  adminUrl: string,
  options: { database: string; role: string; template: string; attempts?: number; waitMs?: number },
): Promise<{ created: boolean }> {
  const database = assertIdentifier(options.database);
  const role = assertIdentifier(options.role);
  const template = assertIdentifier(options.template);
  let created = false;

  if (!(await databaseExists(adminUrl, database))) {
    const attempts = options.attempts ?? 10;
    for (let attempt = 1; ; attempt += 1) {
      try {
        await withClient(serverUrl(adminUrl), (admin) =>
          admin.$executeRawUnsafe(`CREATE DATABASE "${database}" TEMPLATE "${template}"`),
        );
        created = true;
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (attempt >= attempts || !SOURCE_IN_USE.test(message)) {
          throw error;
        }
        await sleep(options.waitMs ?? 1_000);
      }
    }
  }

  await withClient(serverUrl(adminUrl), async (admin) => {
    await admin.$executeRawUnsafe(`REVOKE CONNECT ON DATABASE "${database}" FROM PUBLIC`);
    await admin.$executeRawUnsafe(`GRANT CONNECT ON DATABASE "${database}" TO "${role}"`);
  });
  return { created };
}

/**
 * Permisos del rol de aplicación sobre lo que hay hoy en la base y sobre lo que creen las migraciones futuras (las corre la
 * cuenta de aprovisionamiento): solo datos, nunca cambiar el esquema. Idempotente.
 */
export async function applyTenantGrants(
  adminUrl: string,
  options: { database: string; role: string },
): Promise<void> {
  const role = assertIdentifier(options.role);
  await withClient(adminUrlFor(adminUrl, options.database), async (client) => {
    await client.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO "${role}"`);
    await client.$executeRawUnsafe(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${role}"`,
    );
    await client.$executeRawUnsafe(
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${role}"`,
    );
    await client.$executeRawUnsafe(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${role}"`,
    );
    await client.$executeRawUnsafe(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO "${role}"`,
    );
  });
}

/** La última migración terminada de una base de negocio, o `null` si no tiene (aún no es de este sistema). */
export async function readSchemaVersion(databaseUrl: string): Promise<string | null> {
  return withClient(databaseUrl, async (client) => {
    const rows = await client.$queryRaw<{ migration_name: string }[]>`
      SELECT "migration_name" FROM "_prisma_migrations"
      WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL
      ORDER BY "finished_at" DESC, "migration_name" DESC
      LIMIT 1
    `;
    return rows[0]?.migration_name ?? null;
  });
}

/** El nombre de la migración más reciente que trae esta versión del sistema (la carpeta `prisma/migrations`). */
export function latestMigrationName(
  migrationsDir = join(process.cwd(), "prisma", "migrations"),
): string {
  // La carpeta de migraciones se lee en tiempo de ejecución: no hay que empaquetar el proyecto entero (turbopackIgnore).
  const names = readdirSync(/*turbopackIgnore: true*/ migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{14}_/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const latest = names[names.length - 1];
  if (!latest) {
    throw new Error(`No hay migraciones en ${migrationsDir}`);
  }
  return latest;
}

/**
 * Aplica las migraciones pendientes a una base de negocio solo si le faltan. Devuelve su versión resultante.
 * Con `force` corre la migración aunque la base ya parezca al día (así aflora una migración fallida a medias).
 */
export async function ensureMigrated(
  adminDatabaseUrl: string,
  deps: { migrate?: (url: string) => Promise<void>; latest?: string; force?: boolean } = {},
): Promise<string> {
  const latest = deps.latest ?? latestMigrationName();
  const current = await readSchemaVersion(adminDatabaseUrl).catch(() => null);
  if (deps.force || current !== latest) {
    await (deps.migrate ?? migrateDatabase)(adminDatabaseUrl);
  }
  const after = await readSchemaVersion(adminDatabaseUrl);
  if (!after) {
    throw new Error("La base no quedó con las migraciones aplicadas");
  }
  return after;
}

/**
 * La plantilla («base dorada») existe, está marcada como plantilla y trae la última migración. Si no, se rehace: se borra,
 * se crea y se migra una vez (segundos); crear un negocio desde ella tarda después milisegundos.
 */
export async function ensureTemplateCurrent(
  adminUrl: string,
  options: { name: string; force?: boolean; latest?: string },
): Promise<{ rebuilt: boolean }> {
  const name = assertIdentifier(options.name);
  const latest = options.latest ?? latestMigrationName();
  if (!options.force && (await databaseExists(adminUrl, name))) {
    const current = await readSchemaVersion(adminDatabaseUrlOf(adminUrl, name)).catch(() => null);
    if (current === latest) {
      return { rebuilt: false };
    }
  }
  await createTemplateDatabase(adminUrl, name);
  return { rebuilt: true };
}

function adminDatabaseUrlOf(adminUrl: string, database: string): string {
  return adminUrlFor(adminUrl, database);
}

/** Cierra a la fuerza todas las conexiones abiertas a una base (para poder renombrarla o borrarla). */
export async function terminateConnections(adminUrl: string, database: string): Promise<void> {
  assertIdentifier(database);
  await withClient(serverUrl(adminUrl), async (admin) => {
    await admin.$executeRaw`
      SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE datname = ${database} AND pid <> pg_backend_pid()
    `;
  });
}

/** Quita la base y el rol de un negocio (lo deshace todo, también si quedó a medias). Tolera que parte ya no exista. */
export async function dropTenantResources(
  adminUrl: string,
  options: { database: string; role: string },
): Promise<void> {
  const database = assertIdentifier(options.database);
  const role = assertIdentifier(options.role);
  await withClient(serverUrl(adminUrl), async (admin) => {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    await admin.$executeRawUnsafe(`DROP ROLE IF EXISTS "${role}"`);
  });
}

/**
 * Archiva la base de un negocio **sin destruirla**: se le quitan al rol sus permisos, se cierran las conexiones, la base se
 * renombra a `archivedName` y el rol se elimina. Los datos quedan en el servidor hasta que se retiren a propósito (Etapa 5).
 */
export async function archiveTenantDatabase(
  adminUrl: string,
  options: { database: string; role: string; archivedName: string },
): Promise<void> {
  const database = assertIdentifier(options.database);
  const role = assertIdentifier(options.role);
  const archivedName = assertIdentifier(options.archivedName);

  if (await databaseExists(adminUrl, database)) {
    await withClient(serverUrl(adminUrl), (admin) =>
      admin.$executeRawUnsafe(`REVOKE CONNECT ON DATABASE "${database}" FROM "${role}"`),
    );
    await terminateConnections(adminUrl, database);
    // Quita lo que el rol tiene concedido dentro de la base (si no, no se puede eliminar el rol).
    await withClient(adminUrlFor(adminUrl, database), (client) =>
      client.$executeRawUnsafe(`DROP OWNED BY "${role}"`),
    );
    await withClient(serverUrl(adminUrl), (admin) =>
      admin.$executeRawUnsafe(`ALTER DATABASE "${database}" RENAME TO "${archivedName}"`),
    );
  }
  await withClient(serverUrl(adminUrl), (admin) =>
    admin.$executeRawUnsafe(`DROP ROLE IF EXISTS "${role}"`),
  );
}

export type ServerInventory = { databases: string[]; roles: string[] };

/**
 * Las bases y roles que el sistema creó en el servidor (nombres `t_*`, `z_archived_*` y `z_replaced_*`), para la conciliación.
 * `z_replaced_*` es la base que una restauración dejó apartada al poner el respaldo en su lugar.
 */
export async function listManagedResources(adminUrl: string): Promise<ServerInventory> {
  return withClient(serverUrl(adminUrl), async (admin) => {
    const databases = await admin.$queryRaw<{ datname: string }[]>`
      SELECT datname FROM pg_database
      WHERE NOT datistemplate
        AND (datname LIKE 't\\_%' OR datname LIKE 'z\\_archived\\_%' OR datname LIKE 'z\\_replaced\\_%')
      ORDER BY datname
    `;
    const roles = await admin.$queryRaw<{ rolname: string }[]>`
      SELECT rolname FROM pg_roles WHERE rolname LIKE 't\\_%' ORDER BY rolname
    `;
    return {
      databases: databases.map((row) => row.datname),
      roles: roles.map((row) => row.rolname),
    };
  });
}

/** Nombres de las bases que existen (para saber si las de los negocios registrados siguen en el servidor). */
export async function listDatabaseNames(adminUrl: string): Promise<Set<string>> {
  return withClient(serverUrl(adminUrl), async (admin) => {
    const rows = await admin.$queryRaw<{ datname: string }[]>`
      SELECT datname FROM pg_database WHERE NOT datistemplate
    `;
    return new Set(rows.map((row) => row.datname));
  });
}
