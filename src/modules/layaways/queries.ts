import type { LayawayStatus, PaymentMethod } from "@/generated/prisma/enums";
import { startOfLocalDay } from "@/lib/dates";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { getBusinessProfile } from "@/modules/settings/service";

const DAY_MS = 86_400_000;
const LIST_LIMIT = 100;

export type LayawayRow = {
  id: string;
  number: string;
  customerId: string;
  customerName: string;
  status: LayawayStatus;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  createdAt: Date;
  expiresAt: Date;
  /** Días de calendario hasta que vence (negativo: ya venció). */
  daysLeft: number;
};

/** Los apartados, los activos primero y los que vencen antes arriba. `onlyActive` deja solo los que siguen abiertos. */
export async function listLayaways(options: {
  q?: string;
  onlyActive: boolean;
}): Promise<LayawayRow[]> {
  const term = options.q?.trim() ?? "";
  const layaways = await db.layaway.findMany({
    where: {
      ...(options.onlyActive ? { status: "ACTIVE" } : {}),
      ...(term
        ? {
            OR: [
              { number: { contains: term, mode: "insensitive" } },
              { customer: { name: { contains: term, mode: "insensitive" } } },
              { customer: { phone: { contains: term } } },
            ],
          }
        : {}),
    },
    orderBy: [{ status: "asc" }, { expiresAt: "asc" }],
    take: LIST_LIMIT,
    include: { customer: { select: { name: true } } },
  });
  const today = startOfLocalDay(new Date()).getTime();
  return layaways.map((layaway) => ({
    id: layaway.id,
    number: layaway.number,
    customerId: layaway.customerId,
    customerName: layaway.customer.name,
    status: layaway.status,
    totalCents: layaway.totalCents,
    paidCents: layaway.paidCents,
    balanceCents: layaway.totalCents - layaway.paidCents,
    createdAt: layaway.createdAt,
    expiresAt: layaway.expiresAt,
    daysLeft: Math.round((startOfLocalDay(layaway.expiresAt).getTime() - today) / DAY_MS),
  }));
}

export type LayawayDetail = LayawayRow & {
  customerPhone: string | null;
  createdByName: string;
  items: {
    id: string;
    productName: string;
    sizeName: string | null;
    colorName: string | null;
    sku: string;
    quantity: number;
    unitPriceCents: number;
  }[];
  payments: {
    id: string;
    createdAt: Date;
    method: PaymentMethod;
    amountCents: number;
    reference: string | null;
    userName: string;
    /** Su número de recibo: el del apartado y el orden del abono (`AP-000001-02`). */
    receiptNumber: string;
  }[];
  sale: { id: string; number: string } | null;
  cancel: { at: Date; reason: string; retainedCents: number; byName: string } | null;
};

export async function getLayawayDetail(id: string): Promise<LayawayDetail | null> {
  const layaway = await db.layaway.findUnique({
    where: { id },
    include: {
      customer: { select: { name: true, phone: true } },
      createdBy: { select: { name: true } },
      cancelledBy: { select: { name: true } },
      sale: { select: { id: true, number: true } },
    },
  });
  if (!layaway) {
    return null;
  }
  // En secuencia: lecturas cortas que no compiten por la misma conexión.
  const items = await db.layawayItem.findMany({ where: { layawayId: id }, orderBy: { id: "asc" } });
  const payments = await db.layawayPayment.findMany({
    where: { layawayId: id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: { user: { select: { name: true } } },
  });
  const today = startOfLocalDay(new Date()).getTime();
  return {
    id: layaway.id,
    number: layaway.number,
    customerId: layaway.customerId,
    customerName: layaway.customer.name,
    customerPhone: layaway.customer.phone,
    createdByName: layaway.createdBy.name,
    status: layaway.status,
    totalCents: layaway.totalCents,
    paidCents: layaway.paidCents,
    balanceCents: layaway.totalCents - layaway.paidCents,
    createdAt: layaway.createdAt,
    expiresAt: layaway.expiresAt,
    daysLeft: Math.round((startOfLocalDay(layaway.expiresAt).getTime() - today) / DAY_MS),
    items: items.map((item) => ({
      id: item.id,
      productName: item.productName,
      sizeName: item.sizeName,
      colorName: item.colorName,
      sku: item.sku,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
    })),
    payments: payments.map((payment, index) => ({
      id: payment.id,
      createdAt: payment.createdAt,
      method: payment.method,
      amountCents: payment.amountCents,
      reference: payment.reference,
      userName: payment.user.name,
      receiptNumber: `${layaway.number}-${String(index + 1).padStart(2, "0")}`,
    })),
    sale: layaway.sale,
    cancel:
      layaway.cancelledAt && layaway.cancelReason
        ? {
            at: layaway.cancelledAt,
            reason: layaway.cancelReason,
            retainedCents: layaway.retainedCents,
            byName: layaway.cancelledBy?.name ?? "",
          }
        : null,
  };
}

export type LayawayReceipt = {
  receiptNumber: string;
  createdAt: Date;
  method: PaymentMethod;
  amountCents: number;
  reference: string | null;
  receivedByName: string;
  layaway: {
    id: string;
    number: string;
    customerName: string;
    totalCents: number;
    /** Lo abonado hasta este recibo, este incluido. */
    paidUntilHereCents: number;
    balanceAfterCents: number;
    expiresAt: Date;
    items: {
      productName: string;
      sizeName: string | null;
      colorName: string | null;
      quantity: number;
    }[];
  };
  business: { legalName: string; tradeName: string; taxId: string; address: string; phone: string };
  footer: string;
};

/** Todo lo que lleva el recibo de un abono: el saldo es el que quedó justo después de ese abono. */
export async function getLayawayReceipt(paymentId: string): Promise<LayawayReceipt | null> {
  const payment = await db.layawayPayment.findUnique({
    where: { id: paymentId },
    include: { user: { select: { name: true } } },
  });
  if (!payment) {
    return null;
  }
  const layaway = await db.layaway.findUniqueOrThrow({
    where: { id: payment.layawayId },
    include: { customer: { select: { name: true } } },
  });
  const items = await db.layawayItem.findMany({
    where: { layawayId: layaway.id },
    orderBy: { id: "asc" },
  });
  const all = await db.layawayPayment.findMany({
    where: { layawayId: layaway.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, amountCents: true },
  });
  const position = all.findIndex((entry) => entry.id === payment.id);
  const paidUntilHereCents = all
    .slice(0, position + 1)
    .reduce((sum, entry) => sum + entry.amountCents, 0);
  const business = await getBusinessProfile();
  const footer = await getSetting(db, "ticket.footer");
  return {
    receiptNumber: `${layaway.number}-${String(position + 1).padStart(2, "0")}`,
    createdAt: payment.createdAt,
    method: payment.method,
    amountCents: payment.amountCents,
    reference: payment.reference,
    receivedByName: payment.user.name,
    layaway: {
      id: layaway.id,
      number: layaway.number,
      customerName: layaway.customer.name,
      totalCents: layaway.totalCents,
      paidUntilHereCents,
      balanceAfterCents: layaway.totalCents - paidUntilHereCents,
      expiresAt: layaway.expiresAt,
      items: items.map((item) => ({
        productName: item.productName,
        sizeName: item.sizeName,
        colorName: item.colorName,
        quantity: item.quantity,
      })),
    },
    business,
    footer,
  };
}

/** Los apartados de un cliente, para su ficha. */
export async function listCustomerLayaways(customerId: string): Promise<LayawayRow[]> {
  const rows = await listLayaways({ onlyActive: false });
  return rows.filter((row) => row.customerId === customerId);
}
