import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { controlDb, type ControlDb } from "@/lib/tenancy/control-db";
import { adminUrlFor } from "@/lib/tenancy/provision-steps";
import {
  generateTemporaryPassword,
  noteSupportSessionOpened,
  readSupportAudit,
  readSupportCashSessions,
  readSupportSales,
  readSupportUsers,
  supportResetPassword,
  supportUnlockUser,
  type SupportAuditRow,
  type SupportCashRow,
  type SupportNotice,
  type SupportSaleRow,
  type SupportUserRow,
} from "@/lib/tenancy/support-reader";
import { recordPlatformAudit } from "@/modules/platform/audit";
import { BACKED_UP_STATUSES } from "@/modules/platform/backups";
import { provisioningConfig, type ProvisioningDeps } from "@/modules/platform/provisioning";
import type { AdminContext } from "@/modules/platform/service";

/**
 * Sesiones de soporte (propuesta SaaS §6): la forma de mirar los datos reales de un negocio sin que el panel «vea de más».
 *
 * - **Sin sesión abierta no se ve nada** del negocio (el panel solo muestra números de lista blanca: `usage.ts`).
 * - Abrir una pide un **motivo** (que se lee después) y una **duración** corta (de 15 minutos a 2 horas, lo exige también la
 *   base). Solo una abierta por persona y negocio.
 * - Abrirla **avisa al negocio**: queda una línea en su propia auditoría con quién, por qué y hasta cuándo.
 * - Cada **vista** y cada **acción** queda en la auditoría de la plataforma, con la sesión a la que pertenece.
 * - Lo que se puede hacer es poco y fijo: ver usuarios, ventas recientes, cierres de caja y la auditoría del negocio (sin sus
 *   contenidos), y dos correcciones de acceso: **desbloquear** a una persona y darle una **contraseña temporal**. No hay «entrar
 *   como» ese usuario.
 */

export const SUPPORT_MINUTES = [15, 30, 60, 120] as const;
export type SupportMinutes = (typeof SUPPORT_MINUTES)[number];

const MINUTE_MS = 60_000;
export const SUPPORT_SECTIONS = ["users", "sales", "cash", "audit"] as const;

type Deps = Pick<ProvisioningDeps, "client" | "config" | "now">;

export type SupportSessionRow = {
  id: string;
  adminUsername: string;
  reason: string;
  startedAt: Date;
  expiresAt: Date;
  endedAt: Date | null;
};

const nowOf = (deps: Deps): Date => (deps.now ?? (() => new Date()))();

async function tenantBySlug(client: ControlDb, slug: string) {
  const tenant = await client.tenant.findUnique({ where: { slug } });
  if (!tenant) {
    throw new NotFoundError("No existe ese negocio");
  }
  return tenant;
}

/** Quien abre una sesión es una persona con cuenta en la plataforma: los procesos del sistema no la tienen. */
function requireAdmin(context: AdminContext): { id: string; username: string } {
  if (!context.actor) {
    throw new ForbiddenError("Las sesiones de soporte las abre una persona desde el panel");
  }
  return context.actor;
}

/** Una sesión sigue valiendo si nadie la cerró y todavía no venció. */
export function isOpen(session: { endedAt: Date | null; expiresAt: Date }, now: Date): boolean {
  return session.endedAt === null && session.expiresAt.getTime() > now.getTime();
}

/** La sesión abierta de esta persona en este negocio, o `null` (cerrada, vencida o nunca abierta). */
export async function getOpenSupportSession(
  slug: string,
  adminId: string,
  deps: Deps = {},
): Promise<SupportSessionRow | null> {
  const client = deps.client ?? controlDb;
  const session = await client.supportSession.findFirst({
    where: { tenant: { slug }, adminId, endedAt: null, expiresAt: { gt: nowOf(deps) } },
    select: {
      id: true,
      adminUsername: true,
      reason: true,
      startedAt: true,
      expiresAt: true,
      endedAt: true,
    },
  });
  return session;
}

/** Las últimas sesiones de un negocio, la más reciente primero (de cualquier persona). */
export async function listSupportSessions(
  tenantId: string,
  deps: Pick<Deps, "client"> = {},
  take = 8,
): Promise<SupportSessionRow[]> {
  return (deps.client ?? controlDb).supportSession.findMany({
    where: { tenantId },
    orderBy: { startedAt: "desc" },
    take,
    select: {
      id: true,
      adminUsername: true,
      reason: true,
      startedAt: true,
      expiresAt: true,
      endedAt: true,
    },
  });
}

export async function openSupportSession(
  input: { slug: string; reason: string; minutes: number },
  context: AdminContext,
  deps: Deps = {},
): Promise<SupportSessionRow> {
  const client = deps.client ?? controlDb;
  const config = provisioningConfig(deps.config);
  const admin = requireAdmin(context);
  const now = nowOf(deps);

  const reason = input.reason.trim();
  if (reason.length < 10 || reason.length > 300) {
    throw new ValidationError("Escribe el motivo de la sesión (entre 10 y 300 caracteres)");
  }
  if (!(SUPPORT_MINUTES as readonly number[]).includes(input.minutes)) {
    throw new ValidationError("Elige cuánto dura la sesión: 15, 30, 60 o 120 minutos");
  }
  const tenant = await tenantBySlug(client, input.slug);
  if (!tenant.dbName || !BACKED_UP_STATUSES.includes(tenant.status)) {
    throw new ConflictError("Ese negocio no tiene una base de datos que consultar");
  }

  const expiresAt = new Date(now.getTime() + input.minutes * MINUTE_MS);
  // Primero se crea la fila (su id viaja en el aviso al negocio); si el aviso falla, la sesión no queda abierta.
  const session = await client.$transaction(async (tx) => {
    // Una vencida que nadie cerró se cierra sola, para que el índice «una abierta por persona» no estorbe.
    await tx.supportSession.updateMany({
      where: { tenantId: tenant.id, adminId: admin.id, endedAt: null },
      data: { endedAt: now },
    });
    const created = await tx.supportSession.create({
      data: {
        tenantId: tenant.id,
        adminId: admin.id,
        adminUsername: admin.username,
        reason,
        startedAt: now,
        expiresAt,
      },
      select: {
        id: true,
        adminUsername: true,
        reason: true,
        startedAt: true,
        expiresAt: true,
        endedAt: true,
      },
    });
    await recordPlatformAudit(tx, {
      action: "SUPPORT_SESSION_OPENED",
      actor: context.actor,
      tenantId: tenant.id,
      targetType: "SupportSession",
      targetId: created.id,
      details: {
        slug: tenant.slug,
        reason,
        minutes: input.minutes,
        expiresAt: expiresAt.toISOString(),
      },
      ip: context.ip,
    });
    try {
      await noteSupportSessionOpened(adminUrlFor(config.adminUrl, tenant.dbName as string), {
        platformAdmin: admin.username,
        reason,
        sessionId: created.id,
        expiresAt,
      });
    } catch (error) {
      // Sin poder avisar al negocio no se abre: deshace la fila y la auditoría.
      throw new ConflictError(
        `No se pudo avisar al negocio ni abrir la sesión: ${error instanceof Error ? error.message.split("\n")[0] : "error"}`,
      );
    }
    return created;
  });
  return session;
}

/** Cierra la sesión abierta de esta persona en este negocio. Si no hay ninguna, no hace nada. */
export async function closeSupportSession(
  slug: string,
  context: AdminContext,
  deps: Deps = {},
): Promise<void> {
  const client = deps.client ?? controlDb;
  const admin = requireAdmin(context);
  const now = nowOf(deps);
  const tenant = await tenantBySlug(client, slug);
  await client.$transaction(async (tx) => {
    const open = await tx.supportSession.findFirst({
      where: { tenantId: tenant.id, adminId: admin.id, endedAt: null },
      select: { id: true },
    });
    if (!open) {
      return;
    }
    await tx.supportSession.update({ where: { id: open.id }, data: { endedAt: now } });
    await recordPlatformAudit(tx, {
      action: "SUPPORT_SESSION_CLOSED",
      actor: context.actor,
      tenantId: tenant.id,
      targetType: "SupportSession",
      targetId: open.id,
      details: { slug },
      ip: context.ip,
    });
  });
}

/** Todo lo que se hace con datos del negocio pasa por aquí: exige la sesión, deja el rastro y devuelve la dirección de su base. */
async function withSupport<T>(
  slug: string,
  context: AdminContext,
  what: {
    action: "SUPPORT_VIEWED" | "SUPPORT_USER_UNLOCKED" | "SUPPORT_PASSWORD_RESET";
    detail: Record<string, unknown>;
  },
  deps: Deps,
  run: (databaseUrl: string, notice: SupportNotice) => Promise<T>,
): Promise<T> {
  const client = deps.client ?? controlDb;
  const config = provisioningConfig(deps.config);
  const admin = requireAdmin(context);
  const tenant = await tenantBySlug(client, slug);
  const session = await getOpenSupportSession(slug, admin.id, deps);
  if (!session) {
    throw new ConflictError(
      "Abre una sesión de soporte (con su motivo) para ver los datos del negocio",
    );
  }
  if (!tenant.dbName) {
    throw new ConflictError("Ese negocio no tiene una base de datos que consultar");
  }
  await recordPlatformAudit(client, {
    action: what.action,
    actor: context.actor,
    tenantId: tenant.id,
    targetType: "SupportSession",
    targetId: session.id,
    details: { slug, ...what.detail },
    ip: context.ip,
  });
  return run(adminUrlFor(config.adminUrl, tenant.dbName), {
    platformAdmin: admin.username,
    reason: session.reason,
    sessionId: session.id,
  });
}

export type SupportView = {
  users: SupportUserRow[];
  sales: SupportSaleRow[];
  cash: SupportCashRow[];
  audit: SupportAuditRow[];
};

/** Lo que el soporte puede ver de un negocio, en una sola lectura (y un solo registro en la auditoría). */
export async function viewSupport(
  slug: string,
  context: AdminContext,
  deps: Deps = {},
): Promise<SupportView> {
  return withSupport(
    slug,
    context,
    { action: "SUPPORT_VIEWED", detail: { sections: SUPPORT_SECTIONS } },
    deps,
    async (url) => {
      const [users, sales, cash, audit] = await Promise.all([
        readSupportUsers(url),
        readSupportSales(url),
        readSupportCashSessions(url),
        readSupportAudit(url),
      ]);
      return { users, sales, cash, audit };
    },
  );
}

export async function unlockBusinessUser(
  input: { slug: string; userId: string },
  context: AdminContext,
  deps: Deps = {},
): Promise<{ username: string }> {
  return withSupport(
    input.slug,
    context,
    { action: "SUPPORT_USER_UNLOCKED", detail: { userId: input.userId } },
    deps,
    async (url, notice) => {
      const done = await supportUnlockUser(url, { userId: input.userId, notice });
      if (!done) {
        throw new NotFoundError("Esa persona no existe en el negocio");
      }
      return done;
    },
  );
}

/** Devuelve la contraseña temporal UNA vez: no se guarda ni se anota; quien llama se la da a la persona por un medio seguro. */
export async function resetBusinessUserPassword(
  input: { slug: string; userId: string },
  context: AdminContext,
  deps: Deps = {},
): Promise<{ username: string; temporaryPassword: string }> {
  const temporaryPassword = generateTemporaryPassword();
  return withSupport(
    input.slug,
    context,
    { action: "SUPPORT_PASSWORD_RESET", detail: { userId: input.userId } },
    deps,
    async (url, notice) => {
      const done = await supportResetPassword(url, {
        userId: input.userId,
        password: temporaryPassword,
        notice,
      });
      if (!done) {
        throw new NotFoundError("Esa persona no existe en el negocio");
      }
      return { ...done, temporaryPassword };
    },
  );
}

/** Cuántas sesiones de soporte hay abiertas ahora (para el aviso del Resumen). */
export async function countOpenSupportSessions(deps: Deps = {}): Promise<number> {
  return (deps.client ?? controlDb).supportSession.count({
    where: { endedAt: null, expiresAt: { gt: nowOf(deps) } },
  });
}
