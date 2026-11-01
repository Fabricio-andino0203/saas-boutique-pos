import type { Prisma } from "@/generated/control/client";

export const PLATFORM_AUDIT_ACTIONS = [
  "PLATFORM_LOGIN",
  "PLATFORM_LOGIN_FAILED",
  "PLATFORM_2FA_FAILED",
  "PLATFORM_ACCOUNT_LOCKED",
  "PLATFORM_LOGOUT",
  "PLATFORM_2FA_ENABLED",
  "PLATFORM_2FA_RESET",
  "PLATFORM_USER_CREATED",
  "PLATFORM_USER_DEACTIVATED",
  "PLATFORM_USER_REACTIVATED",
  "PLATFORM_USER_UNLOCKED",
  "PLATFORM_PASSWORD_CHANGED",
  "PLATFORM_KEY_ROTATED",
  "TENANT_ADOPTED",
  "TENANT_SUSPENDED",
  "TENANT_REACTIVATED",
  "TENANT_PROVISION_STARTED",
  "TENANT_PROVISIONED",
  "TENANT_PROVISION_FAILED",
  "TENANT_PROVISION_RESUMED",
  "TENANT_PROVISION_UNDONE",
  "TENANT_MIGRATION_FAILED",
  "FLEET_MIGRATED",
  "TENANT_DELETION_REQUESTED",
  "TENANT_DELETION_CANCELLED",
  "TENANT_ARCHIVED",
  "TENANT_CANARY_CHANGED",
  "PLAN_CREATED",
  "PLAN_UPDATED",
  "SUBSCRIPTION_ASSIGNED",
  "SUBSCRIPTION_PLAN_CHANGED",
  "SUBSCRIPTION_PLAN_SCHEDULED",
  "SUBSCRIPTION_PAYMENT_REGISTERED",
  "SUBSCRIPTION_ADJUSTED",
  "SUBSCRIPTION_PAST_DUE",
  "SUBSCRIPTION_READ_ONLY",
  "SUBSCRIPTION_CANCELLED",
] as const;

export type PlatformAuditAction = (typeof PLATFORM_AUDIT_ACTIONS)[number];

export type PlatformActor = { id: string; username: string };

export type PlatformAuditEntry = {
  action: PlatformAuditAction;
  /** Quién actuó; `null` cuando lo hizo el sistema o no se pudo identificar a nadie. */
  actor: PlatformActor | null;
  tenantId?: string;
  targetType?: string;
  targetId?: string;
  details?: Record<string, unknown>;
  ip?: string;
};

/** Claves que nunca deben llegar a la auditoría aunque alguien las pase por descuido. */
const SECRET_KEY = /pass(word)?|secret|token|credential|private|totp|otp/i;

/** Copia los detalles sin ningún valor cuya clave parezca un secreto. */
export function sanitizeDetails(
  details: Record<string, unknown> | undefined,
): Prisma.InputJsonValue | undefined {
  if (!details) {
    return undefined;
  }
  const clean = Object.fromEntries(
    Object.entries(details).filter(([key, value]) => value !== undefined && !SECRET_KEY.test(key)),
  );
  return clean as Prisma.InputJsonValue;
}

/** Anota una acción en la auditoría de la plataforma. Recibe el cliente o la transacción donde ocurre el cambio. */
export async function recordPlatformAudit(
  client: Pick<Prisma.TransactionClient, "platformAuditLog">,
  entry: PlatformAuditEntry,
): Promise<void> {
  await client.platformAuditLog.create({
    data: {
      actorId: entry.actor?.id ?? null,
      actorUsername: entry.actor?.username ?? null,
      action: entry.action,
      tenantId: entry.tenantId ?? null,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      details: sanitizeDetails(entry.details),
      ip: entry.ip ?? null,
    },
  });
}
