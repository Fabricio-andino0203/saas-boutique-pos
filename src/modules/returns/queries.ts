import type { PaymentMethod, RefundMethod, ReturnItemCondition } from "@/generated/prisma/enums";
import { startOfLocalDay } from "@/lib/dates";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { formatFiscalNumber } from "@/modules/fiscal/issuer";
import { evaluateReturnPolicy } from "@/modules/returns/policy";
import { getBusinessProfile } from "@/modules/settings/service";

const SEARCH_LIMIT = 10;
const DAY_MS = 86_400_000;

export type ReturnSearchRow = {
  id: string;
  number: string;
  createdAt: Date;
  customerName: string | null;
  totalCents: number;
  /** Días de calendario desde la venta. */
  daysSince: number;
  /** Prendas vendidas y cuántas ya se devolvieron. */
  units: number;
  returnedUnits: number;
};

/** Las ventas (no anuladas) que coinciden con el ticket o el cliente que se escribió; sin texto, las más recientes. */
export async function searchSalesForReturn(q: string): Promise<ReturnSearchRow[]> {
  const term = q.trim();
  const sales = await db.sale.findMany({
    where: {
      status: "COMPLETED",
      ...(term
        ? {
            OR: [
              { number: { contains: term, mode: "insensitive" } },
              { customer: { name: { contains: term, mode: "insensitive" } } },
              { customer: { phone: { contains: term } } },
              { customerNameOnInvoice: { contains: term, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: SEARCH_LIMIT,
    include: {
      customer: { select: { name: true } },
      items: { select: { id: true, quantity: true } },
    },
  });
  const itemIds = sales.flatMap((sale) => sale.items.map((item) => item.id));
  const returned = await db.returnItem.groupBy({
    by: ["saleItemId"],
    where: { saleItemId: { in: itemIds } },
    _sum: { quantity: true },
  });
  const returnedByItem = new Map(returned.map((row) => [row.saleItemId, row._sum.quantity ?? 0]));
  const today = startOfLocalDay(new Date()).getTime();

  return sales.map((sale) => ({
    id: sale.id,
    number: sale.number,
    createdAt: sale.createdAt,
    customerName: sale.customer?.name ?? sale.customerNameOnInvoice,
    totalCents: sale.totalCents,
    daysSince: Math.round((today - startOfLocalDay(sale.createdAt).getTime()) / DAY_MS),
    units: sale.items.reduce((sum, item) => sum + item.quantity, 0),
    returnedUnits: sale.items.reduce((sum, item) => sum + (returnedByItem.get(item.id) ?? 0), 0),
  }));
}

export type ReturnableLine = {
  saleItemId: string;
  variantId: string;
  productName: string;
  sizeName: string | null;
  colorName: string | null;
  sku: string;
  quantity: number;
  returned: number;
  returnable: number;
  unitPriceCents: number;
  /** Lo que pagó el cliente por la línea (con descuentos y ISV). */
  lineTotalCents: number;
  blockedByCategory: boolean;
};

export type ReturnableSale = {
  id: string;
  number: string;
  createdAt: Date;
  customer: { id: string; name: string; phone: string | null; storeCreditCents: number } | null;
  lines: ReturnableLine[];
  policy: { maxDays: number; daysSince: number; outsideWindow: boolean };
  paymentMethods: PaymentMethod[];
  /** Se puede devolver "al mismo método": solo si se pagó con tarjeta o transferencia. */
  originalRefundable: boolean;
};

/** Una venta lista para devolver: qué prendas se pueden devolver todavía y qué dice la política. */
export async function getReturnableSale(id: string): Promise<ReturnableSale | null> {
  const sale = await db.sale.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, phone: true, storeCreditCents: true } },
      items: { orderBy: { id: "asc" } },
      payments: { select: { method: true } },
    },
  });
  if (!sale || sale.status !== "COMPLETED") {
    return null;
  }
  const returned = await db.returnItem.groupBy({
    by: ["saleItemId"],
    where: { saleItemId: { in: sale.items.map((item) => item.id) } },
    _sum: { quantity: true },
  });
  const returnedByItem = new Map(returned.map((row) => [row.saleItemId, row._sum.quantity ?? 0]));
  const policy = await evaluateReturnPolicy(db, {
    saleCreatedAt: sale.createdAt,
    variantIds: sale.items.map((item) => item.variantId),
  });
  const methods = [...new Set(sale.payments.map((payment) => payment.method))];

  return {
    id: sale.id,
    number: sale.number,
    createdAt: sale.createdAt,
    customer: sale.customer,
    lines: sale.items.map((item) => {
      const already = returnedByItem.get(item.id) ?? 0;
      return {
        saleItemId: item.id,
        variantId: item.variantId,
        productName: item.productName,
        sizeName: item.sizeName,
        colorName: item.colorName,
        sku: item.sku,
        quantity: item.quantity,
        returned: already,
        returnable: item.quantity - already,
        unitPriceCents: item.unitPriceCents,
        lineTotalCents: item.lineTotalCents,
        blockedByCategory: policy.blockedVariantIds.has(item.variantId),
      };
    }),
    policy: {
      maxDays: policy.maxDays,
      daysSince: policy.daysSince,
      outsideWindow: policy.outsideWindow,
    },
    paymentMethods: methods,
    originalRefundable:
      methods.length > 0 &&
      methods.every((method) => method !== "CASH" && method !== "STORE_CREDIT"),
  };
}

export type ReturnDocument = {
  id: string;
  number: string;
  createdAt: Date;
  type: "RETURN" | "EXCHANGE";
  reason: string;
  refundMethod: RefundMethod;
  /** El dinero que se le devolvió (en un cambio, solo lo que sobró de lo nuevo). */
  refundCents: number;
  /** El valor de las prendas que volvieron (en un cambio, lo que se aplicó a la venta nueva más lo que sobró). */
  valueCents: number;
  processedByName: string;
  authorizedByName: string | null;
  sale: { id: string; number: string };
  /** Solo en un cambio: la venta con las prendas que se llevó. */
  exchangeSale: { id: string; number: string } | null;
  /** La nota de crédito con CAI, si la venta original tenía factura y se pudo emitir. */
  creditNote: {
    number: string;
    cai: string;
    rangeStart: string;
    rangeEnd: string;
    deadline: Date;
    originalInvoice: string | null;
    customerTaxId: string | null;
    customerName: string | null;
  } | null;
  /** La venta tenía factura pero no se emitió la nota de crédito (faltaba un rango activo). */
  creditNoteMissing: boolean;
  customer: { name: string; phone: string | null; storeCreditCents: number } | null;
  items: {
    id: string;
    productName: string;
    sizeName: string | null;
    colorName: string | null;
    sku: string;
    quantity: number;
    condition: ReturnItemCondition;
    refundCents: number;
  }[];
  business: { legalName: string; tradeName: string; taxId: string; address: string; phone: string };
  footer: string;
};

/** Todo lo que lleva el comprobante de una devolución. */
export async function getReturnDocument(id: string): Promise<ReturnDocument | null> {
  const doc = await db.returnDoc.findUnique({
    where: { id },
    include: {
      processedBy: { select: { name: true } },
      authorizedBy: { select: { name: true } },
      fiscalRange: true,
      sale: {
        select: {
          id: true,
          number: true,
          fiscalNumber: true,
          customerTaxId: true,
          customerNameOnInvoice: true,
          fiscalRange: { select: { prefix: true } },
          customer: { select: { name: true } },
        },
      },
      exchangeSale: { select: { id: true, number: true } },
      customer: { select: { name: true, phone: true, storeCreditCents: true } },
      items: { orderBy: { id: "asc" }, include: { saleItem: true } },
    },
  });
  if (!doc) {
    return null;
  }
  const business = await getBusinessProfile();
  const footer = await getSetting(db, "ticket.footer");
  return {
    id: doc.id,
    number: doc.number,
    createdAt: doc.createdAt,
    type: doc.type,
    reason: doc.reason,
    refundMethod: doc.refundMethod,
    refundCents: doc.refundCents,
    valueCents: doc.items.reduce((sum, item) => sum + item.refundCents, 0),
    processedByName: doc.processedBy.name,
    authorizedByName: doc.authorizedBy?.name ?? null,
    sale: { id: doc.sale.id, number: doc.sale.number },
    exchangeSale: doc.exchangeSale,
    creditNote:
      doc.fiscalNumber !== null && doc.fiscalRange
        ? {
            number: formatFiscalNumber(doc.fiscalRange.prefix, doc.fiscalNumber),
            cai: doc.fiscalRange.cai,
            rangeStart: formatFiscalNumber(doc.fiscalRange.prefix, doc.fiscalRange.rangeStart),
            rangeEnd: formatFiscalNumber(doc.fiscalRange.prefix, doc.fiscalRange.rangeEnd),
            deadline: doc.fiscalRange.expiresAt,
            originalInvoice:
              doc.sale.fiscalNumber !== null && doc.sale.fiscalRange
                ? formatFiscalNumber(doc.sale.fiscalRange.prefix, doc.sale.fiscalNumber)
                : null,
            customerTaxId: doc.sale.customerTaxId,
            customerName: doc.sale.customerNameOnInvoice ?? doc.sale.customer?.name ?? null,
          }
        : null,
    creditNoteMissing: doc.sale.fiscalNumber !== null && doc.fiscalNumber === null,
    customer: doc.customer,
    items: doc.items.map((item) => ({
      id: item.id,
      productName: item.saleItem.productName,
      sizeName: item.saleItem.sizeName,
      colorName: item.saleItem.colorName,
      sku: item.saleItem.sku,
      quantity: item.quantity,
      condition: item.condition,
      refundCents: item.refundCents,
    })),
    business,
    footer,
  };
}

export type SaleReturnRow = {
  id: string;
  number: string;
  createdAt: Date;
  refundCents: number;
  refundMethod: RefundMethod;
  type: "RETURN" | "EXCHANGE";
  units: number;
};

/** Las devoluciones ya hechas de una venta, para su detalle. */
export async function listReturnsOfSale(saleId: string): Promise<SaleReturnRow[]> {
  const docs = await db.returnDoc.findMany({
    where: { saleId },
    orderBy: { createdAt: "asc" },
    include: { items: { select: { quantity: true } } },
  });
  return docs.map((doc) => ({
    id: doc.id,
    number: doc.number,
    createdAt: doc.createdAt,
    refundCents: doc.refundCents,
    refundMethod: doc.refundMethod,
    type: doc.type,
    units: doc.items.reduce((sum, item) => sum + item.quantity, 0),
  }));
}
