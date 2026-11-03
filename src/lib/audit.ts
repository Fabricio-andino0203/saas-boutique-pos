import type { Prisma } from "@/generated/prisma/client";

export const AUDIT_ACTIONS = [
  "SALE_VOIDED",
  "RETURN_PROCESSED",
  "RETURN_OVERRIDE",
  "STORE_CREDIT_ADJUSTED",
  "CUSTOMER_CREATED",
  "CUSTOMER_UPDATED",
  "CUSTOMER_ARCHIVED",
  "CUSTOMER_RESTORED",
  "LAYAWAY_CANCELLED",
  "DISCOUNT_OVERRIDE",
  "STOCK_ADJUSTED",
  "PRICE_CHANGED",
  "COST_CHANGED",
  "CASH_SESSION_CLOSED",
  "CASH_SESSION_APPROVED",
  "CASH_FLOAT_ADJUSTED",
  "PERMISSION_CHANGED",
  "USER_CREATED",
  "USER_DEACTIVATED",
  "USER_REACTIVATED",
  "CREDENTIALS_RESET",
  "PRODUCT_CREATED",
  "PRODUCT_UPDATED",
  "PRODUCT_ARCHIVED",
  "PRODUCT_RESTORED",
  "PRODUCT_PHOTO_ADDED",
  "PRODUCT_PHOTO_REMOVED",
  "SETTINGS_CHANGED",
  "FISCAL_RANGE_CHANGED",
  "GOODS_RECEIVED",
  "FINANCE_ENTRY_CREATED",
  "FINANCE_ENTRY_VOIDED",
  "FINANCE_CATEGORY_CHANGED",
  "FIXED_COST_CHANGED",
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
