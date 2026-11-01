import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { controlDb, type ControlDb } from "@/lib/tenancy/control-db";
import { invalidateTenantDirectory } from "@/lib/tenancy/control-directory";
import { assertIdentifier, dropDatabase } from "@/lib/tenancy/provision-db";
import {
  databaseExists,
  listManagedResources,
  terminateConnections,
} from "@/lib/tenancy/provision-steps";
import { recordPlatformAudit } from "@/modules/platform/audit";
import { provisioningConfig, type ProvisioningDeps } from "@/modules/platform/provisioning";
import type { AdminContext } from "@/modules/platform/service";

/**
 * Bases apartadas y su borrado guiado (propuesta SaaS §7, «eliminación controlada»).
 *
 * Hay dos clases de base que el sistema nunca destruye por sí solo, porque su contenido ya no tiene otra copia:
 * - **archivadas** (`z_archived_<id>`): el negocio se dio de baja y su base se renombró.
 * - **reemplazadas** (`z_replaced_t_<id>_<fecha>`): una restauración las dejó apartadas al poner un respaldo en su lugar; tienen
 *   lo que se vendió *después* de ese respaldo.
 *
 * Borrarlas de verdad es irreversible, así que se hace en dos pasos que no se pueden saltar: primero un **volcado final**
 * (cifrado, comprobado y guardado por el servicio de respaldos) y solo cuando ese volcado existe y sirve, el borrado, que exige
 * escribir el nombre de la base y la contraseña de quien lo hace.
 */

export const ARCHIVED_PREFIX = "z_archived_";
export const REPLACED_PREFIX = "z_replaced_";

/** `z_replaced_t_<id>_AAAAMMDDHHMMSS` → el id del negocio y el momento (UTC) en que se apartó. */
const REPLACED_NAME = /^z_replaced_t_([a-z0-9]+)_(\d{14})$/;

export function parseReplacedName(name: string): { tenantId: string; at: Date } | null {
  const match = REPLACED_NAME.exec(name);
  if (!match) {
    return null;
  }
  const [, tenantId, stamp] = match as unknown as [string, string, string];
  const iso = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(8, 10)}:${stamp.slice(10, 12)}:${stamp.slice(12, 14)}Z`;
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : { tenantId, at };
}

export type FinalDumpState = "none" | "open" | "failed" | "ok";

export type RetiredDatabase = {
  database: string;
  kind: "archived" | "replaced";
  tenantId: string | null;
  slug: string | null;
  name: string | null;
  /** Desde cuándo está apartada. */
  since: Date | null;
  finalDump: {
    state: FinalDumpState;
    fileName: string | null;
    keepUntil: Date | null;
    finishedAt: Date | null;
    error: string | null;
  };
};

type Deps = Pick<ProvisioningDeps, "client" | "config" | "now">;

/** Las bases apartadas que hay hoy en el servidor, con el estado de su volcado final. */
export async function listRetiredDatabases(deps: Deps = {}): Promise<RetiredDatabase[]> {
  const client: ControlDb = deps.client ?? controlDb;
  const { adminUrl } = provisioningConfig(deps.config);
  const present = (await listManagedResources(adminUrl)).databases.filter(
    (name) => name.startsWith(ARCHIVED_PREFIX) || name.startsWith(REPLACED_PREFIX),
  );
  if (present.length === 0) {
    return [];
  }

  const [archivedOwners, dumps] = await Promise.all([
    client.tenant.findMany({
      where: { archivedDbName: { in: present } },
      select: { id: true, slug: true, name: true, archivedDbName: true, archivedAt: true },
    }),
    client.tenantBackup.findMany({
      where: { scope: "ARCHIVED", database: { in: present } },
      orderBy: { requestedAt: "desc" },
      select: {
        database: true,
        status: true,
        fileName: true,
        keepUntil: true,
        finishedAt: true,
        error: true,
        prunedAt: true,
      },
    }),
  ]);
  const replacedIds = present
    .map((name) => parseReplacedName(name)?.tenantId)
    .filter((id): id is string => Boolean(id));
  const replacedOwners = await client.tenant.findMany({
    where: { id: { in: replacedIds } },
    select: { id: true, slug: true, name: true },
  });

  const dumpFor = (database: string): RetiredDatabase["finalDump"] => {
    const rows = dumps.filter((row) => row.database === database);
    const usable = rows.find((row) => row.status === "OK" && row.prunedAt === null);
    const empty = { fileName: null, keepUntil: null, finishedAt: null, error: null };
    if (usable) {
      return {
        state: "ok",
        fileName: usable.fileName,
        keepUntil: usable.keepUntil,
        finishedAt: usable.finishedAt,
        error: null,
      };
    }
    if (rows.some((row) => row.status === "REQUESTED" || row.status === "RUNNING")) {
      return { state: "open", ...empty };
    }
    const failed = rows.find((row) => row.status === "FAILED");
    return failed
      ? { state: "failed", ...empty, error: failed.error }
      : { state: "none", ...empty };
  };

  return present.sort().map((database): RetiredDatabase => {
    if (database.startsWith(ARCHIVED_PREFIX)) {
      const owner = archivedOwners.find((tenant) => tenant.archivedDbName === database);
      return {
        database,
        kind: "archived",
        tenantId: owner?.id ?? null,
        slug: owner?.slug ?? null,
        name: owner?.name ?? null,
        since: owner?.archivedAt ?? null,
        finalDump: dumpFor(database),
      };
    }
    const parsed = parseReplacedName(database);
    const owner = parsed
      ? replacedOwners.find((tenant) => tenant.id === parsed.tenantId)
      : undefined;
    return {
      database,
      kind: "replaced",
      tenantId: owner?.id ?? null,
      slug: owner?.slug ?? null,
      name: owner?.name ?? null,
      since: parsed?.at ?? null,
      finalDump: dumpFor(database),
    };
  });
}

/** Resuelve de quién es una base apartada, o dice por qué no se puede tocar. */
async function ownerOf(
  client: ControlDb,
  database: string,
): Promise<{ id: string; slug: string; kind: "archived" | "replaced" }> {
  assertIdentifier(database);
  if (database.startsWith(ARCHIVED_PREFIX)) {
    const tenant = await client.tenant.findUnique({
      where: { archivedDbName: database },
      select: { id: true, slug: true, status: true, archivedDroppedAt: true },
    });
    if (!tenant || tenant.status !== "DELETED") {
      throw new NotFoundError("Esa base archivada no pertenece a ningún negocio dado de baja");
    }
    if (tenant.archivedDroppedAt) {
      throw new ConflictError("Esa base ya se borró");
    }
    return { id: tenant.id, slug: tenant.slug, kind: "archived" };
  }
  const parsed = database.startsWith(REPLACED_PREFIX) ? parseReplacedName(database) : null;
  if (!parsed) {
    throw new ValidationError(
      "Solo se pueden retirar bases archivadas o reemplazadas por una restauración",
    );
  }
  const tenant = await client.tenant.findUnique({
    where: { id: parsed.tenantId },
    select: { id: true, slug: true },
  });
  if (!tenant) {
    throw new NotFoundError("Esa base reemplazada no pertenece a ningún negocio registrado");
  }
  return { id: tenant.id, slug: tenant.slug, kind: "replaced" };
}

/**
 * Pide el volcado final de una base apartada. Lo hace el servicio de respaldos (cifrado con la llave propia de esa base,
 * comprobado y guardado por `FINAL_BACKUP_RETENTION_DAYS`); sin él no se puede borrar.
 */
export async function requestFinalDump(
  database: string,
  context: AdminContext,
  deps: Deps = {},
): Promise<{ id: string }> {
  const client: ControlDb = deps.client ?? controlDb;
  const { adminUrl } = provisioningConfig(deps.config);
  const owner = await ownerOf(client, database);
  if (!(await databaseExists(adminUrl, database))) {
    throw new ConflictError("Esa base ya no está en el servidor");
  }
  return client.$transaction(async (tx) => {
    const open = await tx.tenantBackup.findFirst({
      where: { scope: "ARCHIVED", database, status: { in: ["REQUESTED", "RUNNING"] } },
      select: { id: true },
    });
    if (open) {
      throw new ConflictError(
        "Ya hay un volcado pedido o en marcha para esa base: espera a que termine",
      );
    }
    const created = await tx.tenantBackup.create({
      data: {
        scope: "ARCHIVED",
        tenantId: owner.id,
        database,
        trigger: "FINAL",
        status: "REQUESTED",
        requestedById: context.actor?.id ?? null,
        requestedByUsername: context.actor?.username ?? null,
      },
      select: { id: true },
    });
    await recordPlatformAudit(tx, {
      action: "BACKUP_REQUESTED",
      actor: context.actor,
      tenantId: owner.id,
      targetType: "TenantBackup",
      targetId: created.id,
      details: { slug: owner.slug, database, final: true, kind: owner.kind },
      ip: context.ip,
    });
    return created;
  });
}

/**
 * Borra de verdad una base apartada. Exige: que sea archivada o reemplazada, que haya un volcado final **bueno y todavía
 * guardado**, y que se escriba su nombre tal cual. Queda en la auditoría con el archivo del volcado.
 */
export async function dropRetiredDatabase(
  input: { database: string; confirm: string },
  context: AdminContext,
  deps: Deps = {},
): Promise<{ database: string; dumpFile: string }> {
  const client: ControlDb = deps.client ?? controlDb;
  const { adminUrl } = provisioningConfig(deps.config);
  const now = (deps.now ?? (() => new Date()))();

  if (input.confirm.trim() !== input.database) {
    throw new ValidationError("Para borrar, escribe el nombre de la base tal cual");
  }
  const owner = await ownerOf(client, input.database);

  const dump = await client.tenantBackup.findFirst({
    where: {
      scope: "ARCHIVED",
      database: input.database,
      status: "OK",
      prunedAt: null,
      fileName: { not: null },
    },
    orderBy: { finishedAt: "desc" },
    select: { id: true, fileName: true, bytes: true },
  });
  if (!dump?.fileName) {
    throw new ConflictError(
      "No hay un volcado final bueno de esa base: pídelo primero (no se borra nada sin una copia comprobada)",
    );
  }
  if (!(await databaseExists(adminUrl, input.database))) {
    throw new ConflictError("Esa base ya no está en el servidor");
  }

  await terminateConnections(adminUrl, input.database);
  await dropDatabase(adminUrl, input.database);

  await client.$transaction(async (tx) => {
    if (owner.kind === "archived") {
      await tx.tenant.update({ where: { id: owner.id }, data: { archivedDroppedAt: now } });
    }
    await recordPlatformAudit(tx, {
      action: "ARCHIVED_DATABASE_DROPPED",
      actor: context.actor,
      tenantId: owner.id,
      targetType: "Tenant",
      targetId: owner.id,
      details: {
        slug: owner.slug,
        database: input.database,
        kind: owner.kind,
        dumpFile: dump.fileName,
        dumpBytes: dump.bytes,
      },
      ip: context.ip,
    });
  });
  invalidateTenantDirectory();
  return { database: input.database, dumpFile: dump.fileName };
}
