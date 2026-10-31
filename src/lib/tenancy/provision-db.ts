import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

/**
 * Pasos de bajo nivel para crear y quitar la base de un negocio (Etapa 0: prueba de concepto del aprovisionamiento).
 *
 * Diseño de permisos que se comprueba aquí:
 * - La base la crea y **le pertenece** la cuenta de aprovisionamiento (`admin`), que también corre las migraciones.
 * - Cada negocio tiene su propio **rol de aplicación** con `CONNECT` exclusivo sobre su base y solo permisos de datos
 *   (SELECT/INSERT/UPDATE/DELETE): la aplicación no puede cambiar el esquema ni entrar a la base de otro negocio.
 */

const IDENTIFIER = /^[a-z][a-z0-9_]{2,62}$/;
const SECRET = /^[A-Za-z0-9]{16,128}$/;

/** Los nombres de bases y roles los genera el sistema; aun así se validan antes de armar SQL (sin inyección posible). */
export function assertIdentifier(value: string): string {
  if (!IDENTIFIER.test(value)) {
    throw new Error(`Identificador inválido: ${value}`);
  }
  return value;
}

export function randomPassword(): string {
  return randomBytes(24).toString("hex");
}

export function urlFor(
  base: string,
  parts: { database?: string; user?: string; password?: string },
): string {
  const url = new URL(base);
  if (parts.database) {
    url.pathname = `/${parts.database}`;
  }
  if (parts.user) {
    url.username = parts.user;
  }
  if (parts.password) {
    url.password = parts.password;
  }
  return url.toString();
}

/** Abre un cliente corto contra una URL, ejecuta `fn` y lo cierra siempre. */
export async function withClient<T>(
  url: string,
  fn: (client: PrismaClient) => Promise<T>,
): Promise<T> {
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 1 }) });
  try {
    return await fn(client);
  } finally {
    await client.$disconnect();
  }
}

/**
 * Crea la base `name` en el servidor de `adminUrl` si todavía no existe. Devuelve `true` si la creó. Es para desarrollo y
 * pruebas (la base central y la de pruebas); en producción la base la crea el servidor de Postgres.
 */
export async function ensureDatabase(adminUrl: string, name: string): Promise<boolean> {
  assertIdentifier(name);
  return withClient(urlFor(adminUrl, { database: "postgres" }), async (client) => {
    const rows = await client.$queryRaw<{ present: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = ${name}) AS present
    `;
    if (rows[0]?.present) {
      return false;
    }
    await client.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
    return true;
  });
}

/** `prisma migrate deploy` contra una base, en un proceso aparte. Falla con la salida del error si no termina bien. */
export function migrateDatabase(databaseUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["exec", "prisma", "migrate", "deploy"], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`prisma migrate deploy terminó con ${code}:\n${output.slice(-2000)}`)),
    );
  });
}

/** Base "dorada": migrada una vez y marcada como plantilla. Crear un negocio desde ella tarda milisegundos. */
export async function createTemplateDatabase(adminUrl: string, name: string): Promise<void> {
  assertIdentifier(name);
  const server = urlFor(adminUrl, { database: "postgres" });
  await withClient(server, async (admin) => {
    // Una plantilla ya marcada como tal no se puede borrar: primero se le quita la marca (si existe).
    await admin
      .$executeRawUnsafe(`ALTER DATABASE "${name}" WITH IS_TEMPLATE false`)
      .catch(() => undefined);
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  });
  await migrateDatabase(urlFor(adminUrl, { database: name }));
  await withClient(server, (admin) =>
    admin.$executeRawUnsafe(`ALTER DATABASE "${name}" WITH IS_TEMPLATE true`),
  );
}

export type ProvisionedDatabase = {
  database: string;
  role: string;
  password: string;
  /** URL con la que la **aplicación** se conecta a esta base (rol limitado). */
  appUrl: string;
};

/**
 * Crea el rol y la base de un negocio. Con `template` copia la base dorada; sin ella crea una vacía y la migra.
 * Idempotencia: si algo falla a medias, `dropTenantDatabase` deja todo como estaba.
 */
export async function createTenantDatabase(
  adminUrl: string,
  options: { id: string; template?: string; connectionLimit?: number },
): Promise<ProvisionedDatabase> {
  const database = assertIdentifier(`t_${options.id}`);
  const role = database;
  const password = randomPassword();
  if (!SECRET.test(password)) {
    throw new Error("Contraseña generada inválida");
  }
  const limit = options.connectionLimit ?? 10;
  const server = urlFor(adminUrl, { database: "postgres" });

  await withClient(server, async (admin) => {
    await admin.$executeRawUnsafe(
      `CREATE ROLE "${role}" LOGIN PASSWORD '${password}' CONNECTION LIMIT ${Math.trunc(limit)} NOSUPERUSER NOCREATEDB NOCREATEROLE`,
    );
    // Statement timeout del rol: un negocio no puede dejar consultas eternas que acaparen el servidor.
    await admin.$executeRawUnsafe(`ALTER ROLE "${role}" SET statement_timeout = '60s'`);
    const template = options.template ? ` TEMPLATE "${assertIdentifier(options.template)}"` : "";
    await admin.$executeRawUnsafe(`CREATE DATABASE "${database}"${template}`);
    await admin.$executeRawUnsafe(`REVOKE CONNECT ON DATABASE "${database}" FROM PUBLIC`);
    await admin.$executeRawUnsafe(`GRANT CONNECT ON DATABASE "${database}" TO "${role}"`);
  });

  const tenantAdminUrl = urlFor(adminUrl, { database });
  if (!options.template) {
    await migrateDatabase(tenantAdminUrl);
  }
  await withClient(tenantAdminUrl, async (client) => {
    await client.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO "${role}"`);
    await client.$executeRawUnsafe(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${role}"`,
    );
    await client.$executeRawUnsafe(
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${role}"`,
    );
    // Lo que creen las migraciones futuras (las corre la cuenta de aprovisionamiento) queda con los mismos permisos.
    await client.$executeRawUnsafe(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${role}"`,
    );
    await client.$executeRawUnsafe(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO "${role}"`,
    );
  });

  return { database, role, password, appUrl: urlFor(adminUrl, { database, user: role, password }) };
}

/** Deshace `createTenantDatabase` (también sirve si fue a medias). Tolera que parte ya no exista. */
export async function dropTenantDatabase(adminUrl: string, id: string): Promise<void> {
  const database = assertIdentifier(`t_${id}`);
  await withClient(urlFor(adminUrl, { database: "postgres" }), async (admin) => {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    await admin.$executeRawUnsafe(`DROP ROLE IF EXISTS "${database}"`);
  });
}

export async function dropDatabase(adminUrl: string, name: string): Promise<void> {
  assertIdentifier(name);
  await withClient(urlFor(adminUrl, { database: "postgres" }), async (admin) => {
    await admin
      .$executeRawUnsafe(`ALTER DATABASE "${name}" WITH IS_TEMPLATE false`)
      .catch(() => undefined);
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  });
}
