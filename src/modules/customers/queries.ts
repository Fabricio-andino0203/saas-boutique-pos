import type { RefundMethod, ReturnType, StoreCreditReason } from "@/generated/prisma/enums";
import { db } from "@/lib/db";

const RECENT_LIMIT = 10;
const LEDGER_LIMIT = 50;

export type CreditMovementRow = {
  id: string;
  createdAt: Date;
  /** Con signo: positivo abonó, negativo consumió. */
  amountCents: number;
  reason: StoreCreditReason;
  note: string | null;
  userName: string;
  /** El comprobante que originó el movimiento, si lo hay (con su enlace). */
  document: { label: string; href: string } | null;
};

export type CustomerFicha = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  taxId: string | null;
  notes: string | null;
  createdAt: Date;
  archived: boolean;
  storeCreditCents: number;
  movements: CreditMovementRow[];
  sales: { id: string; number: string; createdAt: Date; totalCents: number; voided: boolean }[];
  returns: {
    id: string;
    number: string;
    createdAt: Date;
    refundCents: number;
    refundMethod: RefundMethod;
    type: ReturnType;
  }[];
};

/** El saldo de crédito de tienda de un cliente (para el cobro). `null` si el cliente no existe. */
export async function getCustomerCreditCents(customerId: string): Promise<number | null> {
  const customer = await db.customer.findUnique({
    where: { id: customerId },
    select: { storeCreditCents: true },
  });
  return customer?.storeCreditCents ?? null;
}

/** La ficha básica de un cliente, de solo lectura: sus datos, su saldo de crédito con cada movimiento y lo reciente. */
export async function getCustomerFicha(id: string): Promise<CustomerFicha | null> {
  const customer = await db.customer.findUnique({ where: { id } });
  if (!customer) {
    return null;
  }
  // En secuencia: son lecturas cortas y así no compiten por la misma conexión.
  const entries = await db.storeCreditEntry.findMany({
    where: { customerId: id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: LEDGER_LIMIT,
    include: { user: { select: { name: true } } },
  });
  const sales = await db.sale.findMany({
    where: { customerId: id },
    orderBy: { createdAt: "desc" },
    take: RECENT_LIMIT,
    select: { id: true, number: true, createdAt: true, totalCents: true, status: true },
  });
  const returns = await db.returnDoc.findMany({
    where: { OR: [{ customerId: id }, { sale: { customerId: id } }] },
    orderBy: { createdAt: "desc" },
    take: RECENT_LIMIT,
    select: {
      id: true,
      number: true,
      createdAt: true,
      refundCents: true,
      refundMethod: true,
      type: true,
    },
  });

  // Los números de los comprobantes que originaron los movimientos
  const saleRefs = entries.filter((e) => e.refType === "Sale" && e.refId).map((e) => e.refId!);
  const returnRefs = entries
    .filter((e) => e.refType === "ReturnDoc" && e.refId)
    .map((e) => e.refId!);
  const saleNumbers = new Map(
    (
      await db.sale.findMany({
        where: { id: { in: saleRefs } },
        select: { id: true, number: true },
      })
    ).map((sale) => [sale.id, sale.number]),
  );
  const returnNumbers = new Map(
    (
      await db.returnDoc.findMany({
        where: { id: { in: returnRefs } },
        select: { id: true, number: true },
      })
    ).map((doc) => [doc.id, doc.number]),
  );

  return {
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    taxId: customer.taxId,
    notes: customer.notes,
    createdAt: customer.createdAt,
    archived: customer.archivedAt !== null,
    storeCreditCents: customer.storeCreditCents,
    movements: entries.map((entry) => {
      let document: CreditMovementRow["document"] = null;
      if (entry.refType === "Sale" && entry.refId && saleNumbers.has(entry.refId)) {
        document = { label: saleNumbers.get(entry.refId)!, href: `/ventas/${entry.refId}` };
      } else if (entry.refType === "ReturnDoc" && entry.refId && returnNumbers.has(entry.refId)) {
        document = {
          label: returnNumbers.get(entry.refId)!,
          href: `/imprimir/devolucion/${entry.refId}`,
        };
      }
      return {
        id: entry.id,
        createdAt: entry.createdAt,
        amountCents: entry.amountCents,
        reason: entry.reason,
        note: entry.note,
        userName: entry.user.name,
        document,
      };
    }),
    sales: sales.map((sale) => ({
      id: sale.id,
      number: sale.number,
      createdAt: sale.createdAt,
      totalCents: sale.totalCents,
      voided: sale.status === "VOIDED",
    })),
    returns,
  };
}
