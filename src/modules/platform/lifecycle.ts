import type { TenantStatus } from "@/generated/control/client";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { controlDb, type ControlDb } from "@/lib/tenancy/control-db";
import { invalidateTenantDirectory } from "@/lib/tenancy/control-directory";
import { assertIdentifier } from "@/lib/tenancy/provision-db";
import { archiveTenantDatabase, databaseExists } from "@/lib/tenancy/provision-steps";
import { evictTenantClient } from "@/lib/tenancy/tenant-clients";
import { recordPlatformAudit } from "@/modules/platform/audit";
import { provisioningConfig, type ProvisioningDeps } from "@/modules/platform/provisioning";
import type { AdminContext } from "@/modules/platform/service";

/**
 * Baja controlada de un negocio (propuesta SaaS §7), en tres tiempos y sin destruir nada:
 *
 * 1. **Pedir la baja:** el negocio pasa a `PENDING_DELETION`: deja de atender («cuenta suspendida») y empieza una ventana de
 *    retención (30 días por omisión) en la que todo se puede cancelar.
 * 2. **Cancelar:** vuelve al estado en que estaba.
 * 3. **Archivar** (pasada la retención, con confirmación escrita): la base se **renombra** (`z_archived_…`), se elimina su
 *    rol y el negocio queda `DELETED`. Los datos siguen en el servidor: borrarlos de verdad es una decisión posterior y
 *    explícita (con el respaldo individual de la Etapa 5).
 */

export const DEFAULT_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Estados desde los que se puede pedir la baja. */
const DELETABLE: TenantStatus[] = ["ACTIVE", "SUSPENDED", "MIGRATION_FAILED"];

type LifecycleDeps = Pick<ProvisioningDeps, "client" | "now"> & { retentionDays?: number };

async function tenantBySlug(client: ControlDb, slug: string) {
  const tenant = await client.tenant.findUnique({ where: { slug } });
  if (!tenant) {
    throw new NotFoundError("No existe ese negocio");
  }
  return tenant;
}

export async function requestTenantDeletion(
  input: { slug: string; reason: string },
  context: AdminContext,
  deps: LifecycleDeps = {},
): Promise<{ deleteAfter: Date }> {
  const client = deps.client ?? controlDb;
  const now = (deps.now ?? (() => new Date()))();
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 300) {
    throw new ValidationError("Escribe el motivo de la baja (entre 3 y 300 caracteres)");
  }
  const deleteAfter = new Date(
    now.getTime() + (deps.retentionDays ?? DEFAULT_RETENTION_DAYS) * DAY_MS,
  );

  await client.$transaction(async (tx) => {
    const tenant = await tenantBySlug(tx as ControlDb, input.slug);
    if (!DELETABLE.includes(tenant.status)) {
      throw new ConflictError(
        tenant.status === "PENDING_DELETION"
          ? "Ese negocio ya tiene una baja pendiente"
          : "Ese negocio no se puede dar de baja en su estado actual",
      );
    }
    await tx.tenant.update({
      where: { id: tenant.id },
      data: {
        status: "PENDING_DELETION",
        statusBeforeDeletion: tenant.status,
        deletionRequestedAt: now,
        deleteAfter,
        deletionReason: reason,
      },
    });
    await recordPlatformAudit(tx, {
      action: "TENANT_DELETION_REQUESTED",
      actor: context.actor,
      tenantId: tenant.id,
      targetType: "Tenant",
      targetId: tenant.id,
      details: { slug: tenant.slug, reason, deleteAfter: deleteAfter.toISOString() },
      ip: context.ip,
    });
  });
  invalidateTenantDirectory();
  return { deleteAfter };
}

export async function cancelTenantDeletion(
  slug: string,
  context: AdminContext,
  deps: Pick<LifecycleDeps, "client"> = {},
): Promise<void> {
  const client = deps.client ?? controlDb;
  await client.$transaction(async (tx) => {
    const tenant = await tenantBySlug(tx as ControlDb, slug);
    if (tenant.status !== "PENDING_DELETION") {
      throw new ConflictError("Ese negocio no tiene una baja pendiente que cancelar");
    }
    // Vuelve a como estaba; un negocio en mantenimiento se revisa con la migración, así que vuelve suspendido por prudencia.
    const back: TenantStatus =
      tenant.statusBeforeDeletion === "ACTIVE"
        ? "ACTIVE"
        : (tenant.statusBeforeDeletion ?? "SUSPENDED");
    await tx.tenant.update({
      where: { id: tenant.id },
      data: {
        status: back,
        statusBeforeDeletion: null,
        deletionRequestedAt: null,
        deleteAfter: null,
        deletionReason: null,
      },
    });
    await recordPlatformAudit(tx, {
      action: "TENANT_DELETION_CANCELLED",
      actor: context.actor,
      tenantId: tenant.id,
      targetType: "Tenant",
      targetId: tenant.id,
      details: { slug: tenant.slug, restoredTo: back },
      ip: context.ip,
    });
  });
  invalidateTenantDirectory();
}

/**
 * Archiva un negocio cuya baja ya cumplió la retención. Exige escribir de nuevo su subdominio. Es repetible: si el proceso
 * se interrumpe después de renombrar la base, repetirlo termina de dejar el registro al día.
 */
export async function archiveTenant(
  input: { slug: string; confirm: string; early?: boolean },
  context: AdminContext,
  deps: ProvisioningDeps = {},
): Promise<{ archivedDatabase: string }> {
  const client = deps.client ?? controlDb;
  const config = provisioningConfig(deps.config);
  const now = (deps.now ?? (() => new Date()))();

  if (input.confirm.trim() !== input.slug) {
    throw new ValidationError("Para archivar, escribe el subdominio del negocio tal cual");
  }
  const tenant = await tenantBySlug(client, input.slug);
  if (tenant.status !== "PENDING_DELETION" || !tenant.deleteAfter) {
    throw new ConflictError("Solo se archiva un negocio con una baja pendiente");
  }
  if (now < tenant.deleteAfter && !input.early) {
    throw new ConflictError(
      `La retención termina el ${tenant.deleteAfter.toISOString().slice(0, 10)}: hasta entonces se puede cancelar la baja`,
    );
  }
  if (!tenant.dbName || !tenant.dbRole) {
    throw new ConflictError("Ese negocio no tiene base de datos que archivar");
  }
  // El nombre del archivo sale del id del negocio (no de la fecha): repetir el archivado tras una interrupción da el mismo.
  const finalName = assertIdentifier(`z_archived_${tenant.id}`);

  // Postgres no renombra una base con conexiones abiertas: se sueltan las de este proceso y se cortan las demás.
  evictTenantClient(tenant.id);
  const stillThere = await databaseExists(config.adminUrl, tenant.dbName);
  if (!stillThere && !(await databaseExists(config.adminUrl, finalName))) {
    throw new ConflictError(
      "Ni la base del negocio ni su archivo están en el servidor: revisa la conciliación antes de archivar",
    );
  }
  await archiveTenantDatabase(config.adminUrl, {
    database: tenant.dbName,
    role: tenant.dbRole,
    archivedName: finalName,
  });

  await client.$transaction(async (tx) => {
    await tx.tenant.update({
      where: { id: tenant.id },
      data: {
        status: "DELETED",
        archivedAt: now,
        archivedDbName: finalName,
        dbName: null,
        dbRole: null,
        dbCredentialEnc: null,
      },
    });
    await recordPlatformAudit(tx, {
      action: "TENANT_ARCHIVED",
      actor: context.actor,
      tenantId: tenant.id,
      targetType: "Tenant",
      targetId: tenant.id,
      details: {
        slug: tenant.slug,
        archivedDatabase: finalName,
        reason: tenant.deletionReason,
        early: Boolean(input.early) && now < tenant.deleteAfter!,
      },
      ip: context.ip,
    });
  });
  invalidateTenantDirectory();
  return { archivedDatabase: finalName };
}
