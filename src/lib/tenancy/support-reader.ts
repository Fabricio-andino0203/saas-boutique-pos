import { randomBytes } from "node:crypto";

import type { Role, SaleStatus, CashSessionStatus } from "@/generated/prisma/client";
import { hashSecret } from "@/lib/password";
import { withClient } from "@/lib/tenancy/provision-db";

/**
 * La única puerta por la que el panel de la plataforma lee datos de un negocio: consultas fijas, de solo lectura, que devuelven
 * lo que hace falta para ayudar a quien tiene un problema (quién puede entrar, qué se vendió hoy, cómo cerró la caja, qué se
 * hizo) y nada más: **nunca** contraseñas, PIN, sesiones, clientes ni el contenido de las ventas.
 *
 * Vive en la capa de `tenancy` porque el panel tiene prohibido tocar la base de un negocio (lo vigila una prueba de
 * arquitectura); aquí está a la vista, en un solo archivo, todo lo que puede salir. Quien la llama (`modules/platform/support.ts`)
 * exige una sesión de soporte abierta, con motivo y duración, y la deja en la auditoría.
 */

export type SupportUserRow = {
  id: string;
  name: string;
  username: string;
  role: Role;
  isActive: boolean;
  failedLogins: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
};

export type SupportSaleRow = {
  number: string;
  createdAt: Date;
  totalCents: number;
  status: SaleStatus;
  sellerName: string;
};

export type SupportCashRow = {
  openedAt: Date;
  closedAt: Date | null;
  userName: string;
  status: CashSessionStatus;
  differenceCents: number | null;
};

export type SupportAuditRow = {
  createdAt: Date;
  action: string;
  entityType: string;
  userName: string | null;
};

export async function readSupportUsers(databaseUrl: string): Promise<SupportUserRow[]> {
  return withClient(databaseUrl, (client) =>
    client.user.findMany({
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        username: true,
        role: true,
        isActive: true,
        failedLogins: true,
        lockedUntil: true,
        lastLoginAt: true,
        createdAt: true,
      },
    }),
  );
}

export async function readSupportSales(databaseUrl: string, take = 25): Promise<SupportSaleRow[]> {
  return withClient(databaseUrl, async (client) => {
    const rows = await client.sale.findMany({
      orderBy: { createdAt: "desc" },
      take,
      select: {
        number: true,
        createdAt: true,
        totalCents: true,
        status: true,
        seller: { select: { name: true } },
      },
    });
    return rows.map((row) => ({
      number: row.number,
      createdAt: row.createdAt,
      totalCents: row.totalCents,
      status: row.status,
      sellerName: row.seller.name,
    }));
  });
}

export async function readSupportCashSessions(
  databaseUrl: string,
  take = 15,
): Promise<SupportCashRow[]> {
  return withClient(databaseUrl, async (client) => {
    const rows = await client.cashSession.findMany({
      orderBy: { openedAt: "desc" },
      take,
      select: {
        openedAt: true,
        closedAt: true,
        status: true,
        differenceCents: true,
        user: { select: { name: true } },
      },
    });
    return rows.map((row) => ({
      openedAt: row.openedAt,
      closedAt: row.closedAt,
      userName: row.user.name,
      status: row.status,
      differenceCents: row.differenceCents,
    }));
  });
}

/** Qué se hizo y quién, sin el contenido de los cambios (`before` y `after` pueden traer datos del negocio). */
export async function readSupportAudit(databaseUrl: string, take = 40): Promise<SupportAuditRow[]> {
  return withClient(databaseUrl, async (client) => {
    const rows = await client.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take,
      select: {
        createdAt: true,
        action: true,
        entityType: true,
        user: { select: { name: true } },
      },
    });
    return rows.map((row) => ({
      createdAt: row.createdAt,
      action: row.action,
      entityType: row.entityType,
      userName: row.user?.name ?? null,
    }));
  });
}

// ───────────────────────────── Lo que deja constancia en el negocio ─────────────────────────────

export type SupportNotice = {
  /** El usuario de la plataforma que actúa, tal como queda en el aviso. */
  platformAdmin: string;
  /** El motivo de la sesión de soporte. */
  reason: string;
  sessionId: string;
};

async function writeNotice(
  databaseUrl: string,
  entry: {
    action: string;
    entityType: string;
    entityId: string;
    notice: SupportNotice;
    after?: Record<string, string>;
  },
): Promise<void> {
  await withClient(databaseUrl, (client) =>
    client.auditLog.create({
      data: {
        userId: null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        reason: entry.notice.reason,
        after: { por: `Soporte de la plataforma (@${entry.notice.platformAdmin})`, ...entry.after },
      },
    }),
  );
}

/** Avisa al negocio, en su propia auditoría, que se abrió una sesión de soporte (y hasta cuándo vale). */
export async function noteSupportSessionOpened(
  databaseUrl: string,
  notice: SupportNotice & { expiresAt: Date },
): Promise<void> {
  await writeNotice(databaseUrl, {
    action: "SUPPORT_SESSION_OPENED",
    entityType: "Support",
    entityId: notice.sessionId,
    notice,
    after: { vence: notice.expiresAt.toISOString() },
  });
}

/** Una contraseña temporal legible: 16 caracteres al azar (sin los que se confunden al dictarla). */
export function generateTemporaryPassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(16);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

/** Desbloquea a una persona que se quedó sin poder entrar por intentos fallidos. Devuelve su usuario. */
export async function supportUnlockUser(
  databaseUrl: string,
  input: { userId: string; notice: SupportNotice },
): Promise<{ username: string } | null> {
  return withClient(databaseUrl, async (client) => {
    const user = await client.user.findUnique({
      where: { id: input.userId },
      select: { id: true, username: true },
    });
    if (!user) {
      return null;
    }
    await client.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { failedLogins: 0, lockedUntil: null },
      });
      await tx.auditLog.create({
        data: {
          userId: null,
          action: "SUPPORT_USER_UNLOCKED",
          entityType: "User",
          entityId: user.id,
          reason: input.notice.reason,
          after: { por: `Soporte de la plataforma (@${input.notice.platformAdmin})` },
        },
      });
    });
    return { username: user.username };
  });
}

/**
 * Deja a una persona con una contraseña temporal nueva (la que se le da a quien llama), la desbloquea y cierra sus sesiones.
 * La contraseña no se guarda ni se anota en ningún lado: solo su huella (Argon2) en la base del negocio.
 */
export async function supportResetPassword(
  databaseUrl: string,
  input: { userId: string; password: string; notice: SupportNotice },
): Promise<{ username: string } | null> {
  const passwordHash = await hashSecret(input.password);
  return withClient(databaseUrl, async (client) => {
    const user = await client.user.findUnique({
      where: { id: input.userId },
      select: { id: true, username: true },
    });
    if (!user) {
      return null;
    }
    await client.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash, failedLogins: 0, lockedUntil: null },
      });
      await tx.session.deleteMany({ where: { userId: user.id } });
      await tx.auditLog.create({
        data: {
          userId: null,
          action: "SUPPORT_CREDENTIALS_RESET",
          entityType: "User",
          entityId: user.id,
          reason: input.notice.reason,
          after: {
            kind: "password",
            por: `Soporte de la plataforma (@${input.notice.platformAdmin})`,
          },
        },
      });
    });
    return { username: user.username };
  });
}
