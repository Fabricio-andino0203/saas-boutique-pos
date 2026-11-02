/**
 * Cómo se llega a la base de un negocio: el servidor donde vive (`Tenant.dbServerId`), su nombre y el rol de aplicación.
 * La contraseña no está aquí: sale de la bóveda al armar la URL.
 */

export type ServerEndpoint = { host: string; port: string };

type EndpointEnv = Record<string, string | undefined>;

/**
 * Dónde está cada servidor de Postgres. Hoy solo existe `primary`: el que aloja la base central (o el que se indique con
 * `TENANT_DB_HOST` / `TENANT_DB_PORT`). Añadir servidores (propuesta SaaS §7) es ampliar esta función, sin tocar a los
 * negocios que ya existen. Un servidor desconocido **falla** en vez de caer a otro.
 */
export function serverEndpoint(
  serverId: string,
  source: EndpointEnv = process.env,
): ServerEndpoint {
  if (serverId !== "primary") {
    throw new Error(`Servidor de base de datos desconocido: ${serverId}`);
  }
  const control = source.CONTROL_DATABASE_URL ? new URL(source.CONTROL_DATABASE_URL) : undefined;
  // Un compose sin valor pasa la variable VACÍA: vacío es lo mismo que no definido (si no, toda la plataforma daría 503).
  const host = source.TENANT_DB_HOST?.trim() || control?.hostname;
  const port = source.TENANT_DB_PORT?.trim() || control?.port || "5432";
  if (!host) {
    throw new Error("No se sabe en qué servidor están las bases de los negocios (TENANT_DB_HOST)");
  }
  return { host, port };
}

export type TenantDatabaseParts = {
  endpoint: ServerEndpoint;
  database: string;
  role: string;
  password: string;
};

/** URL de conexión de la aplicación a la base de un negocio. Usuario y contraseña se codifican solos. */
export function tenantDatabaseUrl({
  endpoint,
  database,
  role,
  password,
}: TenantDatabaseParts): string {
  const url = new URL("postgresql://placeholder");
  url.hostname = endpoint.host;
  url.port = endpoint.port;
  url.username = role;
  url.password = password;
  url.pathname = `/${database}`;
  return url.toString();
}

/** Los datos de una URL de Postgres existente (para registrar la base ya en uso como el negocio #1). */
export function parseDatabaseUrl(connectionString: string): {
  host: string;
  port: string;
  database: string;
  role: string;
  password: string;
} {
  const url = new URL(connectionString);
  return {
    host: url.hostname,
    port: url.port || "5432",
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
    role: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}
