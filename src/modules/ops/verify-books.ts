import type { PrismaClient } from "@/generated/prisma/client";
import { expectedCashCents } from "@/modules/cash/expected";
import { loadCashTotals } from "@/modules/cash/service";
import { findCreditDiscrepancies } from "@/modules/credit/reconcile";
import { findReservedDiscrepancies, findStockDiscrepancies } from "@/modules/inventory/reconcile";
import { findOverReturns } from "@/modules/returns/reconcile";

/**
 * Verificación de los libros de una base de datos: las invariantes de `docs/DATA_MODEL.md` §9 más lo mínimo para que
 * alguien pueda entrar. Es lo que se corre después de **restaurar un respaldo** (`pnpm db:verify`) y sirve también como
 * revisión periódica. Solo lee: no modifica nada.
 */

export type BookCheck =
  | "migrations"
  | "owner"
  | "stock"
  | "reserved"
  | "credit"
  | "returns"
  | "sale-totals"
  | "numbering"
  | "cash-sessions";

export type BookProblem = { check: BookCheck; detail: string };

export type BookSummary = {
  users: number;
  products: number;
  customers: number;
  sales: number;
  returns: number;
  cashSessions: number;
  auditLogs: number;
  lastSaleNumber: string | null;
  lastSaleAt: Date | null;
};

export type BooksReport = { ok: boolean; problems: BookProblem[]; summary: BookSummary };

type Client = PrismaClient;

/** Números correlativos: tickets y devoluciones, sin saltos y con el contador al día (invariante 4). */
const NUMBERED = [
  { key: "SALE", table: "Sale" },
  { key: "RETURN", table: "ReturnDoc" },
] as const;

async function numberingProblems(client: Client): Promise<BookProblem[]> {
  const problems: BookProblem[] = [];
  for (const { key, table } of NUMBERED) {
    const [row] = await client.$queryRawUnsafe<{ count: number; max: number | null }[]>(
      `SELECT COUNT(*)::int AS "count", MAX(CAST(split_part("number", '-', 2) AS int))::int AS "max" FROM "${table}"`,
    );
    const counter = await client.documentCounter.findUnique({ where: { key } });
    const count = row?.count ?? 0;
    const max = row?.max ?? 0;
    if (max !== count) {
      problems.push({
        check: "numbering",
        detail: `${table}: hay ${count} documentos pero el número más alto es ${max} (saltos o repetidos)`,
      });
    }
    if (counter && counter.nextValue !== count + 1) {
      problems.push({
        check: "numbering",
        detail: `${key}: el contador va en ${counter.nextValue} y debería ir en ${count + 1}`,
      });
    }
  }
  return problems;
}

async function saleTotalProblems(client: Client): Promise<BookProblem[]> {
  const broken = await client.$queryRaw<{ id: string; number: string }[]>`
    SELECT s."id", s."number" FROM "Sale" s
    LEFT JOIN (SELECT "saleId", SUM("amountCents") AS "paid" FROM "Payment" GROUP BY "saleId") p ON p."saleId" = s."id"
    LEFT JOIN (SELECT "saleId", SUM("lineTotalCents") AS "lines" FROM "SaleItem" GROUP BY "saleId") i ON i."saleId" = s."id"
    WHERE COALESCE(p."paid", 0) - s."changeCents" <> s."totalCents"
       OR COALESCE(i."lines", 0) <> s."totalCents"
       OR s."paidCents" <> COALESCE(p."paid", 0)
    ORDER BY s."number"
    LIMIT 20
  `;
  return broken.map((sale) => ({
    check: "sale-totals" as const,
    detail: `La venta ${sale.number}: los pagos, el vuelto y las líneas no suman su total`,
  }));
}

/** Lo que se guardó al cerrar cada turno es lo que dice la fórmula (invariante 6). */
async function cashSessionProblems(client: Client): Promise<BookProblem[]> {
  const sessions = await client.cashSession.findMany({
    where: { expectedCashCents: { not: null } },
    orderBy: { openedAt: "asc" },
    select: { id: true, expectedCashCents: true, countedCashCents: true, differenceCents: true },
  });
  const problems: BookProblem[] = [];
  for (const session of sessions) {
    const recomputed = expectedCashCents(await loadCashTotals(client, session.id));
    if (recomputed !== session.expectedCashCents) {
      problems.push({
        check: "cash-sessions",
        detail: `Turno ${session.id}: el efectivo esperado guardado (${session.expectedCashCents}) no es el de la fórmula (${recomputed})`,
      });
    }
    if (
      session.countedCashCents !== null &&
      session.differenceCents !== session.countedCashCents - (session.expectedCashCents ?? 0)
    ) {
      problems.push({
        check: "cash-sessions",
        detail: `Turno ${session.id}: la diferencia guardada no es contado − esperado`,
      });
    }
    if (problems.length >= 20) {
      break;
    }
  }
  return problems;
}

async function summarize(client: Client): Promise<BookSummary> {
  const [users, products, customers, sales, returns, cashSessions, auditLogs, last] =
    await Promise.all([
      client.user.count(),
      client.product.count(),
      client.customer.count(),
      client.sale.count(),
      client.returnDoc.count(),
      client.cashSession.count(),
      client.auditLog.count(),
      client.sale.findFirst({
        orderBy: { createdAt: "desc" },
        select: { number: true, createdAt: true },
      }),
    ]);
  return {
    users,
    products,
    customers,
    sales,
    returns,
    cashSessions,
    auditLogs,
    lastSaleNumber: last?.number ?? null,
    lastSaleAt: last?.createdAt ?? null,
  };
}

export async function verifyBooks(client: Client): Promise<BooksReport> {
  const problems: BookProblem[] = [];

  const [{ unfinished } = { unfinished: 0 }] = await client.$queryRaw<{ unfinished: number }[]>`
    SELECT count(*)::int AS "unfinished" FROM "_prisma_migrations"
    WHERE "finished_at" IS NULL AND "rolled_back_at" IS NULL
  `;
  if (unfinished > 0) {
    problems.push({ check: "migrations", detail: `${unfinished} migración(es) sin terminar` });
  }

  if ((await client.user.count({ where: { role: "OWNER", isActive: true } })) === 0) {
    problems.push({
      check: "owner",
      detail: "No hay ningún propietario activo: nadie podría entrar",
    });
  }

  for (const row of await findStockDiscrepancies(client)) {
    problems.push({
      check: "stock",
      detail: `Variante ${row.variantId}: movimientos ${row.movementSum} contra existencia ${row.onHand}`,
    });
  }
  for (const row of await findReservedDiscrepancies(client)) {
    problems.push({
      check: "reserved",
      detail: `Variante ${row.variantId}: reservas ${row.movementSum} contra ${row.reserved} apartadas`,
    });
  }
  for (const row of await findCreditDiscrepancies(client)) {
    problems.push({
      check: "credit",
      detail: `Cliente ${row.customerId}: saldo ${row.cachedCents} contra libro ${row.ledgerCents}`,
    });
  }
  for (const row of await findOverReturns(client)) {
    problems.push({
      check: "returns",
      detail: `Línea ${row.saleItemId}: se devolvieron ${row.returned} de ${row.sold} vendidas`,
    });
  }

  problems.push(...(await saleTotalProblems(client)));
  problems.push(...(await numberingProblems(client)));
  problems.push(...(await cashSessionProblems(client)));

  return { ok: problems.length === 0, problems, summary: await summarize(client) };
}
