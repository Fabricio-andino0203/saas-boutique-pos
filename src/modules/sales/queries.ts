import type { FiscalDocumentType, PaymentMethod, SaleStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { formatFiscalNumber } from "@/modules/fiscal/issuer";
import { getBusinessProfile } from "@/modules/settings/service";

export type SaleDocumentItem = {
  id: string;
  productName: string;
  sizeName: string | null;
  colorName: string | null;
  sku: string;
  quantity: number;
  unitPriceCents: number;
  /** Descuento propio más la parte del descuento global (ver DATA_MODEL). */
  lineDiscountCents: number;
  taxRate: number;
  taxCents: number;
  lineTotalCents: number;
};

export type SaleDocument = {
  id: string;
  number: string;
  status: SaleStatus;
  createdAt: Date;
  sellerId: string;
  sellerName: string;
  /** El turno de caja de la venta sigue abierto: solo entonces se puede anular. */
  shiftOpen: boolean;
  customer: { id: string; name: string; phone: string | null } | null;
  items: SaleDocumentItem[];
  payments: { method: PaymentMethod; amountCents: number; reference: string | null }[];
  /** Σ precio × cantidad, antes de cualquier descuento. */
  grossCents: number;
  /** Todos los descuentos juntos (de línea y global). */
  discountCents: number;
  taxCents: number;
  totalCents: number;
  paidCents: number;
  changeCents: number;
  /** `true` si el ISV ya venía dentro de los precios (el total no lo suma aparte). */
  taxIncluded: boolean;
  invoice: {
    type: FiscalDocumentType;
    number: string;
    cai: string;
    rangeStart: string;
    rangeEnd: string;
    expiresAt: Date;
    customerTaxId: string | null;
    customerName: string | null;
  } | null;
  voided: { at: Date; reason: string | null } | null;
  business: { legalName: string; tradeName: string; taxId: string; address: string; phone: string };
  footer: string;
};

/** Todo lo que lleva un ticket o una factura impresa: la venta, sus líneas y pagos, el negocio y el rango fiscal. */
export async function getSaleDocument(id: string): Promise<SaleDocument | null> {
  const sale = await db.sale.findUnique({
    where: { id },
    include: {
      seller: { select: { name: true } },
      cashSession: { select: { status: true } },
      customer: { select: { id: true, name: true, phone: true } },
      fiscalRange: true,
      items: { orderBy: { id: "asc" } },
      payments: { orderBy: { id: "asc" } },
    },
  });
  if (!sale) {
    return null;
  }
  const business = await getBusinessProfile();
  const footer = await getSetting(db, "ticket.footer");

  const grossCents = sale.items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
  const discountCents = sale.items.reduce((sum, item) => sum + item.lineDiscountCents, 0);
  const range = sale.fiscalRange;

  return {
    id: sale.id,
    number: sale.number,
    status: sale.status,
    createdAt: sale.createdAt,
    sellerId: sale.sellerId,
    sellerName: sale.seller.name,
    shiftOpen: sale.cashSession.status === "OPEN",
    customer: sale.customer,
    items: sale.items.map((item) => ({
      id: item.id,
      productName: item.productName,
      sizeName: item.sizeName,
      colorName: item.colorName,
      sku: item.sku,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      lineDiscountCents: item.lineDiscountCents,
      taxRate: item.taxRate,
      taxCents: item.taxCents,
      lineTotalCents: item.lineTotalCents,
    })),
    payments: sale.payments.map((payment) => ({
      method: payment.method,
      amountCents: payment.amountCents,
      reference: payment.reference,
    })),
    grossCents,
    discountCents,
    taxCents: sale.taxCents,
    totalCents: sale.totalCents,
    paidCents: sale.paidCents,
    changeCents: sale.changeCents,
    // Con el ISV incluido, el total es bruto − descuentos; si se sumó aparte, el total es mayor.
    taxIncluded: sale.totalCents === grossCents - discountCents,
    invoice:
      sale.fiscalDocType && sale.fiscalNumber !== null && range
        ? {
            type: sale.fiscalDocType,
            number: formatFiscalNumber(range.prefix, sale.fiscalNumber),
            cai: range.cai,
            rangeStart: formatFiscalNumber(range.prefix, range.rangeStart),
            rangeEnd: formatFiscalNumber(range.prefix, range.rangeEnd),
            expiresAt: range.expiresAt,
            customerTaxId: sale.customerTaxId,
            customerName: sale.customerNameOnInvoice,
          }
        : null,
    voided: sale.voidedAt ? { at: sale.voidedAt, reason: sale.voidReason } : null,
    business: {
      legalName: business.legalName,
      tradeName: business.tradeName,
      taxId: business.taxId,
      address: business.address,
      phone: business.phone,
    },
    footer,
  };
}
