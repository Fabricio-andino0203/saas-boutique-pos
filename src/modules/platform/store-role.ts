import { ConflictError, NotFoundError } from "@/lib/errors";
import { controlDb, type ControlDb } from "@/lib/tenancy/control-db";
import { invalidateTenantDirectory } from "@/lib/tenancy/control-directory";
import { assertIdentifier, randomPassword, urlFor, withClient } from "@/lib/tenancy/provision-db";
import { applyTenantGrants, databaseExists, ensureTenantRole } from "@/lib/tenancy/provision-steps";
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
 * Rol limitado para la tienda adoptada (el negocio #1).
 *
 * Los negocios que da de alta el sistema atienden con su propio rol de Postgres: solo puede entrar a SU base y solo lee y escribe
 * datos (no cambia el esquema ni toca las bases de los demás). La tienda que ya existía antes de la plataforma, en cambio, se
 * adoptó con la **cuenta principal del servidor**: la misma que crea bases y roles y que es dueña de todo. Si un error de la
 * aplicación llegara a ejecutar SQL ajeno en esa tienda, tendría el servidor entero. Este paso le da a la tienda #1 el mismo
 * trato que a los demás: un rol `t_<id>` con permisos de datos, y la credencial nueva queda en la bóveda.
 *
 * Es **idempotente** (repetirlo no rompe nada) y **reversible a mano**: la cuenta principal sigue existiendo y `DATABASE_URL`
 * (migraciones al arrancar, respaldos, verificación de libros) sigue usándola. Cambia solo con qué cuenta ATIENDE la aplicación.
 */

const LIMITABLE = ["ACTIVE", "SUSPENDED", "MIGRATION_FAILED"] as const;

export type LimitStoreReport = {
  slug: string;
  database: string;
  role: string;
  /** `true` si el negocio ya tenía este rol (solo se volvieron a aplicar los permisos). */
  alreadyLimited: boolean;
  /** Cuántos usuarios se leyeron con el rol nuevo: prueba de que puede entrar. */
  usersVisible: number;
};

/** El rol que le corresponde a un negocio: `t_<id>`. */
export function limitedRoleOf(tenantId: string): string {
  return assertIdentifier(`t_${tenantId}`);
}

export async function limitStoreRole(
  slug: string,
  context: AdminContext,
  deps: ProvisioningDeps = {},
): Promise<LimitStoreReport> {
  const client: ControlDb = deps.client ?? controlDb;
  const vault = deps.vault ?? getVault();
  const { adminUrl } = provisioningConfig(deps.config);

  const tenant = await client.tenant.findUnique({ where: { slug } });
  if (!tenant) {
    throw new NotFoundError("No existe ese negocio");
  }
  if (
    !tenant.dbName ||
    !tenant.dbRole ||
    !tenant.dbCredentialEnc ||
    !(LIMITABLE as readonly string[]).includes(tenant.status)
  ) {
    throw new ConflictError(
      "Ese negocio no tiene una base a la que cambiarle el rol en su estado actual",
    );
  }
  // El nombre de la base de la tienda adoptada lo escribió una persona (la URL de la adopción): se valida antes de armar SQL.
  const database = assertIdentifier(tenant.dbName);
  const role = limitedRoleOf(tenant.id);
  const alreadyLimited = tenant.dbRole === role;
  if (!(await databaseExists(adminUrl, database))) {
    throw new ConflictError("La base de este negocio no está en el servidor");
  }

  const password = alreadyLimited
    ? vault.decrypt(tenant.dbCredentialEnc, vaultContext.tenantDatabase(tenant.id))
    : randomPassword();
  await ensureTenantRole(adminUrl, { role, password });
  await withClient(urlFor(adminUrl, { database: "postgres" }), async (admin) => {
    // Solo el rol de la aplicación entra a esta base (la cuenta de aprovisionamiento y los superusuarios siempre pueden).
    await admin.$executeRawUnsafe(`REVOKE CONNECT ON DATABASE "${database}" FROM PUBLIC`);
    await admin.$executeRawUnsafe(`GRANT CONNECT ON DATABASE "${database}" TO "${role}"`);
  });
  await applyTenantGrants(adminUrl, { database, role });

  // La prueba que importa: entrar con el rol nuevo y leer. Si falta un permiso, falla aquí y la tienda sigue como estaba.
  let usersVisible: number;
  try {
    usersVisible = await withClient(
      urlFor(adminUrl, { database, user: role, password }),
      async (c) => {
        await c.$queryRaw`SELECT count(*)::int AS n FROM "_prisma_migrations"`;
        const rows = await c.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "User"`;
        return rows[0]?.n ?? 0;
      },
    );
  } catch (error) {
    throw new ConflictError(
      `El rol nuevo no puede leer la base, así que no se cambió nada: ${describeFailure(error)}`,
    );
  }

  if (!alreadyLimited) {
    await client.$transaction(async (tx) => {
      await tx.tenant.update({
        where: { id: tenant.id },
        data: {
          dbRole: role,
          dbCredentialEnc: vault.encrypt(password, vaultContext.tenantDatabase(tenant.id)),
        },
      });
      await recordPlatformAudit(tx, {
        action: "TENANT_STORE_ROLE_LIMITED",
        actor: context.actor,
        tenantId: tenant.id,
        targetType: "Tenant",
        targetId: tenant.id,
        details: { slug, database, from: tenant.dbRole, to: role, usersVisible },
        ip: context.ip,
      });
    });
    invalidateTenantDirectory();
    evictTenantClient(tenant.id);
  }
  return { slug, database, role, alreadyLimited, usersVisible };
}
