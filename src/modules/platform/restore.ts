import type { TenantStatus } from "@/generated/control/client";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { controlDb, type ControlDb } from "@/lib/tenancy/control-db";
import { invalidateTenantDirectory } from "@/lib/tenancy/control-directory";
import { urlFor, withClient } from "@/lib/tenancy/provision-db";
import {
  adminUrlFor,
  applyTenantGrants,
  databaseExists,
  ensureMigrated,
  ensureTenantDatabase,
  ensureTenantRole,
  readSchemaVersion,
} from "@/lib/tenancy/provision-steps";
import { evictTenantClient } from "@/lib/tenancy/tenant-clients";
import { getVault, vaultContext } from "@/lib/tenancy/vault";
import { recordPlatformAudit } from "@/modules/platform/audit";
import {
  describeFailure,
  provisioningConfig,
  type ProvisioningDeps,
} from "@/modules/platform/provisioning";
import type { AdminContext } from "@/modules/platform/service";

/**
 * Terminar la restauración de un negocio.
 *
 * Restaurar un respaldo (`restore-tenant.sh`) devuelve **los datos**: las tablas y su contenido. Lo que no viaja en un volcado
 * (se excluye a propósito, con `--no-owner --no-privileges`) es todo lo que depende del **servidor**: el rol de aplicación del
 * negocio, quién puede conectarse a su base y los permisos del rol sobre las tablas. Además, un respaldo puede ser más viejo
 * que la versión actual del sistema. Este paso lo deja todo como estaba, y es **idempotente** (repetirlo no rompe nada):
 *
 * 1. el rol del negocio existe, con la contraseña que guarda la bóveda (en un servidor nuevo hay que crearlo);
 * 2. solo ese rol puede conectarse a la base, y solo con permisos de datos;
 * 3. se aplican las migraciones que le falten al respaldo;
 * 4. se comprueba que el negocio **puede entrar de verdad** con su rol (lo que usará la aplicación).
 *
 * No cambia el estado del negocio: si estaba suspendido para restaurarlo, se reactiva a propósito desde el panel, después de
 * revisar los libros (`pnpm db:verify --tenant …`).
 */

const RELINKABLE: TenantStatus[] = ["ACTIVE", "SUSPENDED", "PENDING_DELETION", "MIGRATION_FAILED"];

/**
 * El sistema administra el rol del negocio: o es `t_<id>` con una base del mismo nombre (lo creó el alta automática), o es el rol
 * `t_<id>` que se le dio a la tienda adoptada (`pnpm tenants:limit-store`). La tienda #1 que sigue con la cuenta principal del
 * servidor no entra aquí: su rol no se toca.
 */
export function hasManagedRole(tenant: {
  id?: string;
  dbName: string | null;
  dbRole: string | null;
}): boolean {
  if (tenant.id && tenant.dbRole === `t_${tenant.id}`) {
    return true;
  }
  return Boolean(
    tenant.dbName && /^t_[a-z0-9]+$/.test(tenant.dbName) && tenant.dbRole === tenant.dbName,
  );
}

export type RelinkReport = {
  slug: string;
  database: string;
  /** `false` en la tienda #1 que sigue conectándose con la cuenta principal del servidor. */
  roleManaged: boolean;
  schemaFrom: string | null;
  schemaTo: string;
  /** Cuántos usuarios se leyeron con el rol del negocio: prueba de que puede entrar. */
  usersVisible: number;
};

export async function relinkTenant(
  slug: string,
  context: AdminContext,
  deps: ProvisioningDeps = {},
): Promise<RelinkReport> {
  const client: ControlDb = deps.client ?? controlDb;
  const vault = deps.vault ?? getVault();
  const { adminUrl, templateDb } = provisioningConfig(deps.config);

  const tenant = await client.tenant.findUnique({ where: { slug } });
  if (!tenant) {
    throw new NotFoundError("No existe ese negocio");
  }
  if (
    !tenant.dbName ||
    !tenant.dbRole ||
    !tenant.dbCredentialEnc ||
    !RELINKABLE.includes(tenant.status)
  ) {
    throw new ConflictError("Ese negocio no tiene una base que reconectar en su estado actual");
  }
  const database = tenant.dbName;
  const role = tenant.dbRole;
  if (!(await databaseExists(adminUrl, database))) {
    throw new ConflictError(
      "La base de este negocio no está en el servidor: restáurala primero desde un respaldo (restore-tenant.sh)",
    );
  }

  // Esta aplicación puede tener conexiones abiertas a la base de antes de restaurar: se sueltan para que abra las nuevas.
  evictTenantClient(tenant.id);

  const password = vault.decrypt(tenant.dbCredentialEnc, vaultContext.tenantDatabase(tenant.id));
  const roleManaged = hasManagedRole(tenant);
  if (roleManaged) {
    await ensureTenantRole(adminUrl, { role, password });
    // La base ya existe: esto solo deja el acceso exclusivo para el rol (no la vuelve a crear).
    await ensureTenantDatabase(adminUrl, { database, role, template: templateDb });
    await applyTenantGrants(adminUrl, { database, role });
  }

  const adminDatabaseUrl = adminUrlFor(adminUrl, database);
  const schemaFrom = await readSchemaVersion(adminDatabaseUrl).catch(() => null);
  const schemaTo = await ensureMigrated(adminDatabaseUrl, {
    ...(deps.migrate ? { migrate: deps.migrate } : {}),
  }).catch(async (error: unknown) => {
    // Un respaldo que no se puede llevar a la versión actual deja al negocio «en mantenimiento», como en cualquier migración.
    const message = describeFailure(error);
    await client.tenant.update({
      where: { id: tenant.id },
      data: {
        migrationError: message,
        migrationFailedAt: new Date(),
        ...(tenant.status === "ACTIVE" ? { status: "MIGRATION_FAILED" } : {}),
      },
    });
    invalidateTenantDirectory();
    throw new ConflictError(
      `La base se restauró pero no se pudo actualizar a la versión actual: ${message}`,
    );
  });

  // La prueba que importa: entrar con el rol de la aplicación y leer. Si falta un permiso, falla aquí y no en la tienda.
  let usersVisible: number;
  try {
    usersVisible = await withClient(
      urlFor(adminUrl, { database, user: role, password }),
      async (c) => {
        const rows = await c.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "User"`;
        return rows[0]?.n ?? 0;
      },
    );
  } catch (error) {
    throw new ConflictError(
      `El negocio no puede entrar a su base con su rol: ${describeFailure(error)}`,
    );
  }

  await client.$transaction(async (tx) => {
    await tx.tenant.update({
      where: { id: tenant.id },
      data: {
        schemaVersion: schemaTo,
        migrationError: null,
        migrationFailedAt: null,
        ...(tenant.status === "MIGRATION_FAILED" ? { status: "ACTIVE" } : {}),
      },
    });
    await recordPlatformAudit(tx, {
      action: "TENANT_RELINKED",
      actor: context.actor,
      tenantId: tenant.id,
      targetType: "Tenant",
      targetId: tenant.id,
      details: { slug, database, roleManaged, schemaFrom, schemaTo, usersVisible },
      ip: context.ip,
    });
  });
  invalidateTenantDirectory();
  return { slug, database, roleManaged, schemaFrom, schemaTo, usersVisible };
}
