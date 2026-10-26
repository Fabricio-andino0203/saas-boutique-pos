import type { Prisma } from "@/generated/prisma/client";

export const AUDIT_ACTIONS = [
  "SALE_VOIDED",
  "DISCOUNT_OVERRIDE",
  "STOCK_ADJUSTED",
  "PRICE_CHANGED",
  "COST_CHANGED",
  "CASH_SESSION_CLOSED",
  "PERMISSION_CHANGED",
  "USER_CREATED",
  "USER_DEACTIVATED",
  "USER_REACTIVATED",
  "CREDENTIALS_RESET",
  "PRODUCT_CREATED",
  "PRODUCT_UPDATED",
  "PRODUCT_ARCHIVED",
  "PRODUCT_RESTORED",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditEntry = {
  userId?: string | null;
  action: AuditAction;
  entityType: string;
  entityId: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  reason?: string;
  ip?: string;
};

export const audit = {
  async log(tx: Pick<Prisma.TransactionClient, "auditLog">, entry: AuditEntry): Promise<void> {
    await tx.auditLog.create({
      data: {
        userId: entry.userId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        before: entry.before,
        after: entry.after,
        reason: entry.reason,
        ip: entry.ip,
      },
    });
  },
};
