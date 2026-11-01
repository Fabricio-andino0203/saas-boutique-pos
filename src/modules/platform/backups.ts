import type { BackupStatus, TenantStatus } from "@/generated/control/client";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { controlDb, type ControlDb } from "@/lib/tenancy/control-db";
import { assertIdentifier } from "@/lib/tenancy/provision-db";
import { parseDatabaseUrl } from "@/lib/tenancy/tenant-url";
import { recordPlatformAudit } from "@/modules/platform/audit";
import type { AdminContext } from "@/modules/platform/service";

/**
 * Respaldos por negocio (propuesta SaaS §7), del lado de la aplicación.
 *
 * **Quién hace qué.** Quien tiene la clave de cifrado y la carpeta de archivos es el servicio `backup` (otro contenedor, con
 * `pg_dump`): él respalda, comprueba y retira lo vencido, y **anota cada respaldo** en `TenantBackup`. La aplicación no tiene la
 * clave ni ve los archivos: solo **lee ese registro** para el panel y **agrega pedidos** («respalda ahora»), que el servicio
 * toma en unos segundos. Así, una aplicación comprometida no puede descifrar ningún respaldo.
 *
 * El estado de cada negocio sale de ese registro y de la hora (`backupStateOf`), igual que el acceso por suscripción sale de
 * las fechas: no hay un «estado de respaldo» guardado que pueda quedar desactualizado.
 */

/** Mismo plazo que la prueba de salud del servicio `backup`: un respaldo diario más un margen de 2 horas. */
export const BACKUP_FRESH_MS = 26 * 60 * 60 * 1000;

/** Días que se conservan los respaldos de un negocio sin plan (es el valor del servidor: `BACKUP_RETENTION_DAYS`). */
export const DEFAULT_BACKUP_RETENTION_DAYS = 30;

/** Estados en los que el negocio tiene una base en el servidor y por tanto debe tener respaldos. */
export const BACKED_UP_STATUSES: TenantStatus[] = [
  "ACTIVE",
  "SUSPENDED",
  "PENDING_DELETION",
  "MIGRATION_FAILED",
];

const OPEN: BackupStatus[] = ["REQUESTED", "RUNNING"];

export const BACKUP_STATES = ["ok", "stale", "failed", "never", "pending"] as const;
export type BackupState = (typeof BACKUP_STATES)[number];

/**
 * Cómo está el respaldo de un negocio (o de la base central) en este momento:
 * - `ok`      hay un respaldo bueno de las últimas 26 horas.
 * - `stale`   hubo respaldos buenos, pero el último ya es más viejo.
 * - `failed`  lo último que se intentó falló y no hay uno bueno reciente.
 * - `never`   lleva más de 26 horas dado de alta y nunca tuvo un respaldo bueno.
 * - `pending` es nuevo: todavía no le toca el primero.
 */
export function backupStateOf(
  input: { lastOkAt: Date | null; lastFailureAt: Date | null; createdAt: Date },
  now: Date,
): BackupState {
  if (input.lastOkAt && now.getTime() - input.lastOkAt.getTime() <= BACKUP_FRESH_MS) {
    return "ok";
  }
  const failedAfterOk =
    input.lastFailureAt !== null &&
    (input.lastOkAt === null || input.lastFailureAt.getTime() > input.lastOkAt.getTime());
  if (failedAfterOk) {
    return "failed";
  }
  if (input.lastOkAt) {
    return "stale";
  }
  return now.getTime() - input.createdAt.getTime() <= BACKUP_FRESH_MS ? "pending" : "never";
}

/** Los estados que piden que alguien haga algo. */
export function needsAttention(state: BackupState): boolean {
  return state === "stale" || state === "failed" || state === "never";
}

type Deps = { client?: ControlDb; now?: () => Date };

const nowOf = (deps: Deps): Date => (deps.now ?? (() => new Date()))();

/** El nombre de la base central, tal como lo conoce el servicio de respaldos. */
export function controlDatabaseName(env: Record<string, string | undefined> = process.env): string {
  const url = env.CONTROL_DATABASE_URL;
  const name = url ? parseDatabaseUrl(url).database : undefined;
  return assertIdentifier(name ?? "boutique_pos_control");
}

// ───────────────────────────── Lectura ─────────────────────────────

export type BackupRow = {
  id: string;
  trigger: "SCHEDULED" | "MANUAL" | "FINAL";
  status: BackupStatus;
  fileName: string | null;
  bytes: number | null;
  schemaVersion: string | null;
  error: string | null;
  requestedByUsername: string | null;
  requestedAt: Date;
  finishedAt: Date | null;
  keepUntil: Date | null;
  prunedAt: Date | null;
};

const ROW_SELECT = {
  id: true,
  trigger: true,
  status: true,
  fileName: true,
  bytes: true,
  schemaVersion: true,
  error: true,
  requestedByUsername: true,
  requestedAt: true,
  finishedAt: true,
  keepUntil: true,
  prunedAt: true,
} as const;

/** Los últimos respaldos de un negocio, el más reciente primero (incluidos los fallidos y los ya retirados). */
export async function listTenantBackups(
  tenantId: string,
  options: { take?: number } = {},
  deps: Deps = {},
): Promise<BackupRow[]> {
  return (deps.client ?? controlDb).tenantBackup.findMany({
    where: { tenantId, scope: "TENANT" },
    orderBy: { requestedAt: "desc" },
    take: options.take ?? 15,
    select: ROW_SELECT,
  });
}

/** Los últimos respaldos de la base central. */
export async function listControlBackups(
  options: { take?: number } = {},
  deps: Deps = {},
): Promise<BackupRow[]> {
  return (deps.client ?? controlDb).tenantBackup.findMany({
    where: { scope: "CONTROL" },
    orderBy: { requestedAt: "desc" },
    take: options.take ?? 10,
    select: ROW_SELECT,
  });
}

/** El respaldo bueno más reciente cuyo archivo todavía existe: el que se usaría para restaurar. */
export async function latestUsableBackup(
  tenantId: string,
  deps: Deps = {},
): Promise<BackupRow | null> {
  return (deps.client ?? controlDb).tenantBackup.findFirst({
    where: { tenantId, scope: "TENANT", status: "OK", prunedAt: null },
    orderBy: { finishedAt: "desc" },
    select: ROW_SELECT,
  });
}

export type BackupOverviewRow = {
  slug: string;
  name: string;
  status: TenantStatus;
  state: BackupState;
  lastOkAt: Date | null;
  lastFailureAt: Date | null;
  /** Ya hay un respaldo pedido o en marcha. */
  open: boolean;
  /** Cuántos días se conservan sus respaldos (el de su plan, o el del servidor si no tiene plan). */
  retentionDays: number;
  retentionFromPlan: boolean;
};

export type BackupOverview = {
  tenants: BackupOverviewRow[];
  control: {
    state: BackupState;
    lastOkAt: Date | null;
    lastFailureAt: Date | null;
    open: boolean;
  };
  /** Los negocios con algo que atender, los peores primero (la base central, si falla, va al principio). */
  attention: { kind: "control" | "tenant"; slug?: string; name?: string; state: BackupState }[];
};

const SEVERITY: Record<BackupState, number> = { failed: 0, never: 1, stale: 2, pending: 3, ok: 4 };

/** El estado de los respaldos de todos los negocios que deben tenerlos, y de la base central. */
export async function backupOverview(deps: Deps = {}): Promise<BackupOverview> {
  const client = deps.client ?? controlDb;
  const now = nowOf(deps);

  const [tenants, grouped] = await Promise.all([
    client.tenant.findMany({
      where: { status: { in: BACKED_UP_STATUSES }, dbName: { not: null } },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        slug: true,
        name: true,
        status: true,
        createdAt: true,
        subscriptions: {
          where: { status: { not: "EXPIRED" } },
          take: 1,
          select: { plan: { select: { backupRetentionDays: true } } },
        },
      },
    }),
    client.tenantBackup.groupBy({
      by: ["tenantId", "scope", "status"],
      where: { scope: { in: ["TENANT", "CONTROL"] } },
      _max: { finishedAt: true },
      _count: { _all: true },
    }),
  ]);

  const summaryFor = (tenantId: string | null, scope: "TENANT" | "CONTROL") => {
    const rows = grouped.filter((row) => row.tenantId === tenantId && row.scope === scope);
    const latest = (status: BackupStatus) =>
      rows.find((row) => row.status === status)?._max.finishedAt ?? null;
    return {
      lastOkAt: latest("OK"),
      lastFailureAt: latest("FAILED"),
      open: rows.some((row) => OPEN.includes(row.status)),
    };
  };

  const rows: BackupOverviewRow[] = tenants.map((tenant) => {
    const summary = summaryFor(tenant.id, "TENANT");
    const planDays = tenant.subscriptions[0]?.plan.backupRetentionDays;
    return {
      slug: tenant.slug,
      name: tenant.name,
      status: tenant.status,
      state: backupStateOf({ ...summary, createdAt: tenant.createdAt }, now),
      ...summary,
      retentionDays: planDays ?? DEFAULT_BACKUP_RETENTION_DAYS,
      retentionFromPlan: planDays !== undefined,
    };
  });

  const controlSummary = summaryFor(null, "CONTROL");
  // La base central no tiene fecha de alta: se mide desde su primer respaldo (o se da por «nunca» si ya hay negocios viejos).
  const oldestTenant = tenants[0]?.createdAt ?? now;
  const control = {
    ...controlSummary,
    state: backupStateOf({ ...controlSummary, createdAt: oldestTenant }, now),
  };

  const attention: BackupOverview["attention"] = [
    ...(needsAttention(control.state) ? [{ kind: "control" as const, state: control.state }] : []),
    ...rows
      .filter((row) => needsAttention(row.state))
      .sort((a, b) => SEVERITY[a.state] - SEVERITY[b.state])
      .map((row) => ({
        kind: "tenant" as const,
        slug: row.slug,
        name: row.name,
        state: row.state,
      })),
  ];
  return { tenants: rows, control, attention };
}

// ───────────────────────────── Pedidos ─────────────────────────────

async function assertNoOpenRequest(
  client: ControlDb,
  where: { tenantId: string } | { scope: "CONTROL" },
): Promise<void> {
  const open = await client.tenantBackup.findFirst({
    where: { ...where, status: { in: OPEN } },
    select: { id: true },
  });
  if (open) {
    throw new ConflictError("Ya hay un respaldo pedido o en marcha: espera a que termine");
  }
}

/**
 * Pide un respaldo ahora de la base de un negocio. No lo hace la aplicación: lo deja pedido y el servicio de respaldos lo toma
 * en unos segundos (si ese servicio no está corriendo, el pedido queda esperando y el panel lo muestra).
 */
export async function requestTenantBackup(
  slug: string,
  context: AdminContext,
  deps: Deps = {},
): Promise<{ id: string }> {
  const client = deps.client ?? controlDb;
  return client.$transaction(async (tx) => {
    const tenant = await tx.tenant.findUnique({ where: { slug } });
    if (!tenant) {
      throw new NotFoundError("No existe ese negocio");
    }
    if (!tenant.dbName || !BACKED_UP_STATUSES.includes(tenant.status)) {
      throw new ConflictError("Ese negocio no tiene una base que respaldar en su estado actual");
    }
    await assertNoOpenRequest(tx as ControlDb, { tenantId: tenant.id });
    const created = await tx.tenantBackup.create({
      data: {
        scope: "TENANT",
        tenantId: tenant.id,
        database: tenant.dbName,
        trigger: "MANUAL",
        status: "REQUESTED",
        requestedById: context.actor?.id ?? null,
        requestedByUsername: context.actor?.username ?? null,
      },
      select: { id: true },
    });
    await recordPlatformAudit(tx, {
      action: "BACKUP_REQUESTED",
      actor: context.actor,
      tenantId: tenant.id,
      targetType: "TenantBackup",
      targetId: created.id,
      details: { slug: tenant.slug, database: tenant.dbName },
      ip: context.ip,
    });
    return created;
  });
}

/** Pide un respaldo ahora de la base central de la plataforma. */
export async function requestControlBackup(
  context: AdminContext,
  deps: Deps & { database?: string } = {},
): Promise<{ id: string }> {
  const client = deps.client ?? controlDb;
  const database = deps.database ?? controlDatabaseName();
  return client.$transaction(async (tx) => {
    await assertNoOpenRequest(tx as ControlDb, { scope: "CONTROL" });
    const created = await tx.tenantBackup.create({
      data: {
        scope: "CONTROL",
        database,
        trigger: "MANUAL",
        status: "REQUESTED",
        requestedById: context.actor?.id ?? null,
        requestedByUsername: context.actor?.username ?? null,
      },
      select: { id: true },
    });
    await recordPlatformAudit(tx, {
      action: "BACKUP_REQUESTED",
      actor: context.actor,
      targetType: "TenantBackup",
      targetId: created.id,
      details: { database },
      ip: context.ip,
    });
    return created;
  });
}

// ───────────────────────────── Un negocio ─────────────────────────────

export type TenantBackupStatus = {
  state: BackupState;
  lastOkAt: Date | null;
  lastFailureAt: Date | null;
  open: boolean;
  retentionDays: number;
  retentionFromPlan: boolean;
};

/** El estado del respaldo de un solo negocio (lo que muestra su página), sin recorrer a los demás. */
export async function getTenantBackupStatus(
  tenantId: string,
  createdAt: Date,
  deps: Deps = {},
): Promise<TenantBackupStatus> {
  const client = deps.client ?? controlDb;
  const [lastOk, lastFailure, open, subscription] = await Promise.all([
    client.tenantBackup.findFirst({
      where: { tenantId, scope: "TENANT", status: "OK" },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true },
    }),
    client.tenantBackup.findFirst({
      where: { tenantId, scope: "TENANT", status: "FAILED" },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true },
    }),
    client.tenantBackup.findFirst({
      where: { tenantId, scope: "TENANT", status: { in: OPEN } },
      select: { id: true },
    }),
    client.subscription.findFirst({
      where: { tenantId, status: { not: "EXPIRED" } },
      select: { plan: { select: { backupRetentionDays: true } } },
    }),
  ]);
  const lastOkAt = lastOk?.finishedAt ?? null;
  const lastFailureAt = lastFailure?.finishedAt ?? null;
  const planDays = subscription?.plan.backupRetentionDays;
  return {
    state: backupStateOf({ lastOkAt, lastFailureAt, createdAt }, nowOf(deps)),
    lastOkAt,
    lastFailureAt,
    open: open !== null,
    retentionDays: planDays ?? DEFAULT_BACKUP_RETENTION_DAYS,
    retentionFromPlan: planDays !== undefined,
  };
}

/** `125616` → «122.7 KB». */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}
