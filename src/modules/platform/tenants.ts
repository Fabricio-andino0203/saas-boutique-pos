import { controlDb, type ControlDb } from "@/lib/tenancy/control-db";
import { invalidateTenantDirectory } from "@/lib/tenancy/control-directory";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { readSchemaVersion } from "@/lib/tenancy/provision-steps";
import { isReservedSlug, isValidSlug } from "@/lib/tenancy/slug";
import { parseDatabaseUrl } from "@/lib/tenancy/tenant-url";
import { getVault, vaultContext, type Vault } from "@/lib/tenancy/vault";
import { recordPlatformAudit } from "@/modules/platform/audit";
import type { AdminContext } from "@/modules/platform/service";

/**
 * Altas y cambios de estado de los negocios que la plataforma ya conoce. El alta automática de negocios nuevos (con su base
 * propia) llega en la Etapa 3; en la Etapa 2 solo se registra el negocio que ya existe: la tienda actual como negocio #1.
 */

// La lectura vive en la capa de aprovisionamiento; se reexporta porque otros módulos y pruebas la usan desde aquí.
export { readSchemaVersion };

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export type AdoptStoreInput = {
  slug: string;
  name: string;
  ownerEmail?: string | undefined;
  /** La URL con la que la tienda ya se conecta hoy a su base (la de `DATABASE_URL`). */
  databaseUrl: string;
};

export type AdoptStoreDeps = {
  client?: ControlDb;
  vault?: Pick<Vault, "encrypt">;
  /** Para pruebas: cómo se sabe la versión del esquema de la base. */
  schemaVersionOf?: (databaseUrl: string) => Promise<string | null>;
};

/**
 * Registra la tienda que ya está en uso como negocio #1 **sin tocar ni mover sus datos**: solo se anota en la base central
 * dónde está su base y se guarda su credencial cifrada en la bóveda. Después de esto la tienda se atiende en
 * `<slug>.<dominio base>`.
 *
 * La cuenta con la que se conecta (hoy la principal del servidor) se usa tal cual; los negocios nuevos tendrán un rol propio
 * con permisos solo de datos (Etapa 3). No se vuelve a registrar una base ya registrada.
 */
export async function adoptExistingStore(
  input: AdoptStoreInput,
  context: AdminContext,
  deps: AdoptStoreDeps = {},
): Promise<{ id: string; slug: string; schemaVersion: string | null }> {
  const client = deps.client ?? controlDb;
  const vault = deps.vault ?? getVault();
  const schemaVersionOf = deps.schemaVersionOf ?? readSchemaVersion;

  const slug = input.slug.trim().toLowerCase();
  const name = input.name.trim();
  if (!isValidSlug(slug)) {
    throw new ValidationError(
      "El subdominio solo puede tener letras minúsculas, números y guiones (hasta 40 caracteres)",
    );
  }
  if (isReservedSlug(slug)) {
    throw new ValidationError(`El subdominio "${slug}" está reservado: elige otro`);
  }
  if (name.length < 2 || name.length > 120) {
    throw new ValidationError("El nombre del negocio debe tener entre 2 y 120 caracteres");
  }

  const database = parseDatabaseUrl(input.databaseUrl);
  if (!database.database || !database.role || !database.password) {
    throw new ValidationError("La URL de la base debe incluir base de datos, usuario y contraseña");
  }

  const existing = await client.tenant.findFirst({
    where: { OR: [{ slug }, { dbName: database.database }] },
    select: { slug: true, dbName: true },
  });
  if (existing) {
    throw new ConflictError(
      existing.slug === slug
        ? `Ya existe un negocio con el subdominio "${slug}"`
        : `La base "${database.database}" ya está registrada como el negocio "${existing.slug}"`,
    );
  }

  // Se comprueba que la base responde y es de este sistema antes de anotar nada.
  let schemaVersion: string | null;
  try {
    schemaVersion = await schemaVersionOf(input.databaseUrl);
  } catch (cause) {
    throw new ValidationError(
      "No se pudo leer la base de la tienda: revisa la URL, el usuario y la contraseña, y que tenga las migraciones aplicadas",
      { cause },
    );
  }
  if (!schemaVersion) {
    throw new ValidationError("La base no tiene las migraciones de Boutique Ventas aplicadas");
  }

  try {
    const tenant = await client.$transaction(async (tx) => {
      // El id lo genera la base: la credencial se cifra atada a él, así que se crea primero "en preparación".
      const created = await tx.tenant.create({
        data: { slug, name, ownerEmail: input.ownerEmail ?? null, status: "PROVISIONING" },
        select: { id: true },
      });
      await tx.tenant.update({
        where: { id: created.id },
        data: {
          status: "ACTIVE",
          dbServerId: "primary",
          dbName: database.database,
          dbRole: database.role,
          dbCredentialEnc: vault.encrypt(
            database.password,
            vaultContext.tenantDatabase(created.id),
          ),
          schemaVersion,
        },
      });
      await recordPlatformAudit(tx, {
        action: "TENANT_ADOPTED",
        actor: context.actor,
        tenantId: created.id,
        targetType: "Tenant",
        targetId: created.id,
        details: { slug, name, database: database.database, schemaVersion },
        ip: context.ip,
      });
      return created;
    });
    invalidateTenantDirectory();
    return { id: tenant.id, slug, schemaVersion };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError("Ese subdominio o esa base ya están registrados");
    }
    throw error;
  }
}

/** Marca o desmarca un negocio como canario: se migra primero y, si falla, no se toca al resto de la flota. */
export async function setTenantCanary(
  input: { slug: string; canary: boolean },
  context: AdminContext,
  client: ControlDb = controlDb,
): Promise<void> {
  await client.$transaction(async (tx) => {
    const tenant = await tx.tenant.findUnique({ where: { slug: input.slug } });
    if (!tenant) {
      throw new NotFoundError("No existe ese negocio");
    }
    if (tenant.canary === input.canary) {
      return;
    }
    await tx.tenant.update({ where: { id: tenant.id }, data: { canary: input.canary } });
    await recordPlatformAudit(tx, {
      action: "TENANT_CANARY_CHANGED",
      actor: context.actor,
      tenantId: tenant.id,
      targetType: "Tenant",
      targetId: tenant.id,
      details: { slug: tenant.slug, canary: input.canary },
      ip: context.ip,
    });
  });
}

export type TenantStatusChange = { slug: string; status: "SUSPENDED" | "ACTIVE" };

/**
 * Suspende un negocio activo o reactiva uno suspendido. Los datos no se tocan: solo cambia lo que se muestra al llegar a su
 * dirección. Surte efecto de inmediato en este proceso y en los demás cuando vence su caché del directorio
 * (`TENANT_DIRECTORY_TTL_MS`, 20 segundos por omisión).
 */
export async function setTenantStatus(
  input: TenantStatusChange,
  context: AdminContext,
  client: ControlDb = controlDb,
): Promise<void> {
  await client.$transaction(async (tx) => {
    const tenant = await tx.tenant.findUnique({ where: { slug: input.slug } });
    if (!tenant) {
      throw new NotFoundError("No existe ese negocio");
    }
    const from = input.status === "SUSPENDED" ? "ACTIVE" : "SUSPENDED";
    if (tenant.status === input.status) {
      return; // ya estaba así
    }
    if (tenant.status !== from) {
      throw new ConflictError(
        `Un negocio en estado ${tenant.status} no se puede ${input.status === "SUSPENDED" ? "suspender" : "reactivar"}`,
      );
    }
    await tx.tenant.update({ where: { id: tenant.id }, data: { status: input.status } });
    await recordPlatformAudit(tx, {
      action: input.status === "SUSPENDED" ? "TENANT_SUSPENDED" : "TENANT_REACTIVATED",
      actor: context.actor,
      tenantId: tenant.id,
      targetType: "Tenant",
      targetId: tenant.id,
      details: { slug: tenant.slug, from: tenant.status, to: input.status },
      ip: context.ip,
    });
  });
  invalidateTenantDirectory();
}
