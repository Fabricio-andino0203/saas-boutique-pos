import type { CashMovementType, CashSessionStatus, PaymentMethod } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { expectedCashCents, type CashTotals } from "@/modules/cash/expected";
import { getDefaultTerminal, loadCashTotals } from "@/modules/cash/service";

const PAGE_SIZE = 20;

export type CashSessionRow = {
  id: string;
  status: CashSessionStatus;
  terminalName: string;
  userId: string;
  userName: string;
  openedAt: Date;
  closedAt: Date | null;
  openingFloatCents: number;
  expectedCashCents: number | null;
  countedCashCents: number | null;
  differenceCents: number | null;
};

const rowSelect = {
  id: true,
  status: true,
  userId: true,
  openedAt: true,
  closedAt: true,
  openingFloatCents: true,
  expectedCashCents: true,
  countedCashCents: true,
  differenceCents: true,
  terminal: { select: { name: true } },
  user: { select: { name: true } },
} as const;

type RowRecord = {
  id: string;
  status: CashSessionStatus;
  userId: string;
  openedAt: Date;
  closedAt: Date | null;
  openingFloatCents: number;
  expectedCashCents: number | null;
  countedCashCents: number | null;
  differenceCents: number | null;
  terminal: { name: string };
  user: { name: string };
};

function toRow(record: RowRecord): CashSessionRow {
  const { terminal, user, ...rest } = record;
  return { ...rest, terminalName: terminal.name, userName: user.name };
}

/** La caja abierta de un usuario, si tiene. */
export async function getOpenSessionOf(userId: string): Promise<CashSessionRow | null> {
  const record = await db.cashSession.findFirst({
    where: { userId, status: "OPEN" },
    select: rowSelect,
  });
  return record ? toRow(record) : null;
}

/** Quién tiene abierta la terminal por defecto (para avisar antes de intentar abrirla). */
export async function getTerminalStatus(): Promise<{
  terminalId: string;
  terminalName: string;
  openBy: string | null;
}> {
  const terminal = await getDefaultTerminal(db);
  const open = await db.cashSession.findFirst({
    where: { terminalId: terminal.id, status: "OPEN" },
    select: { user: { select: { name: true } } },
  });
  return { terminalId: terminal.id, terminalName: terminal.name, openBy: open?.user.name ?? null };
}

export type CashSessionList = {
  rows: CashSessionRow[];
  total: number;
  page: number;
  pageSize: number;
};

/** Cierres de caja, del más reciente al más antiguo. Con `userId` solo los de esa persona. */
export async function listCashSessions(params: {
  userId?: string;
  status?: CashSessionStatus;
  page?: number;
}): Promise<CashSessionList> {
  const page = Math.max(1, Math.trunc(params.page ?? 1));
  const where = {
    ...(params.userId ? { userId: params.userId } : {}),
    ...(params.status ? { status: params.status } : {}),
  };
  const [records, total] = await Promise.all([
    db.cashSession.findMany({
      where,
      orderBy: { openedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: rowSelect,
    }),
    db.cashSession.count({ where }),
  ]);
  return { rows: records.map(toRow), total, page, pageSize: PAGE_SIZE };
}

/** Cuántos cierres esperan aprobación. */
export function countPendingApprovals(): Promise<number> {
  return db.cashSession.count({ where: { status: "CLOSED_PENDING_APPROVAL" } });
}

export type CashMovementRow = {
  id: string;
  type: CashMovementType;
  amountCents: number;
  reason: string;
  userName: string;
  createdAt: Date;
};

export type CashPaymentSummary = { method: PaymentMethod; amountCents: number; count: number };

export type CashSessionDetail = {
  session: CashSessionRow & { notes: string | null; approvedByName: string | null };
  totals: CashTotals;
  /** En un turno abierto se calcula al momento; en uno cerrado es lo que quedó guardado al cerrar. */
  expectedCents: number;
  movements: CashMovementRow[];
  payments: CashPaymentSummary[];
  sales: { count: number; totalCents: number; voidedCount: number };
  /** Desglose por billetes y monedas, si el cajero lo usó al contar. */
  denominations: Record<string, number> | null;
};

function readDenominations(after: unknown): Record<string, number> | null {
  if (typeof after !== "object" || after === null || !("denominations" in after)) {
    return null;
  }
  const value = after.denominations;
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const entries = Object.entries(value).filter(
    (entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] > 0,
  );
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

export async function getCashSessionDetail(id: string): Promise<CashSessionDetail | null> {
  const record = await db.cashSession.findUnique({
    where: { id },
    select: { ...rowSelect, notes: true, approvedBy: { select: { name: true } } },
  });
  if (!record) {
    return null;
  }
  const { notes, approvedBy, ...rowRecord } = record;

  const [totals, movements, payments, sales, voided, closing] = await Promise.all([
    loadCashTotals(db, id),
    db.cashMovement.findMany({
      where: { cashSessionId: id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        type: true,
        amountCents: true,
        reason: true,
        createdAt: true,
        user: { select: { name: true } },
      },
    }),
    db.payment.groupBy({
      by: ["method"],
      where: { cashSessionId: id, sale: { status: "COMPLETED" } },
      _sum: { amountCents: true },
      _count: { _all: true },
    }),
    db.sale.aggregate({
      _count: { _all: true },
      _sum: { totalCents: true },
      where: { cashSessionId: id, status: "COMPLETED" },
    }),
    db.sale.count({ where: { cashSessionId: id, status: "VOIDED" } }),
    db.auditLog.findFirst({
      where: { entityType: "CashSession", entityId: id, action: "CASH_SESSION_CLOSED" },
      orderBy: { createdAt: "desc" },
      select: { after: true },
    }),
  ]);

  return {
    session: { ...toRow(rowRecord), notes, approvedByName: approvedBy?.name ?? null },
    totals,
    expectedCents: record.expectedCashCents ?? expectedCashCents(totals),
    movements: movements.map(({ user, ...movement }) => ({ ...movement, userName: user.name })),
    payments: payments.map((payment) => ({
      method: payment.method,
      amountCents: payment._sum.amountCents ?? 0,
      count: payment._count._all,
    })),
    sales: {
      count: sales._count._all,
      totalCents: sales._sum.totalCents ?? 0,
      voidedCount: voided,
    },
    denominations: readDenominations(closing?.after),
  };
}
