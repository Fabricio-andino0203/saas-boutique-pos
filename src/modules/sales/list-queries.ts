import type { Prisma } from "@/generated/prisma/client";
import type { PaymentMethod, SaleStatus } from "@/generated/prisma/enums";
import { endOfLocalDay, parseLocalDateKey, startOfLocalDay } from "@/lib/dates";
import { db } from "@/lib/db";
import { formatFiscalNumber } from "@/modules/fiscal/issuer";

const PAGE_SIZE = 20;

export type SaleRow = {
  id: string;
  number: string;
  createdAt: Date;
  sellerName: string;
  customerName: string | null;
  totalCents: number;
  status: SaleStatus;
  fiscalNumber: string | null;
  methods: PaymentMethod[];
  /** Prendas vendidas y cuántas ya se devolvieron (para marcar la venta con devoluciones). */
  soldUnits: number;
  returnedUnits: number;
};

export type SaleList = {
  rows: SaleRow[];
  total: number;
  page: number;
  pageSize: number;
  /** Lo vendido (sin las anuladas) con los mismos filtros. */
  completed: { count: number; totalCents: number };
};

export type SaleListParams = {
  /** Fechas locales `YYYY-MM-DD`; vacías, sin límite. */
  from?: string;
  to?: string;
  status?: SaleStatus;
  sellerId?: string;
  q?: string;
  page?: number;
};

/** Ventas, de la más reciente a la más antigua. Con `onlySellerId` solo las de esa persona (un cajero ve las suyas). */
export async function listSales(
  params: SaleListParams,
  scope: { onlySellerId?: string } = {},
): Promise<SaleList> {
  const page = Math.max(1, Math.trunc(params.page ?? 1));
  const from = params.from ? parseLocalDateKey(params.from) : null;
  const to = params.to ? parseLocalDateKey(params.to) : null;
  const q = params.q?.trim() ?? "";

  const where: Prisma.SaleWhereInput = {
    ...(scope.onlySellerId
      ? { sellerId: scope.onlySellerId }
      : params.sellerId
        ? { sellerId: params.sellerId }
        : {}),
    ...(from || to
      ? {
          createdAt: {
            ...(from ? { gte: startOfLocalDay(from) } : {}),
            ...(to ? { lte: endOfLocalDay(to) } : {}),
          },
        }
      : {}),
    ...(q
      ? {
          OR: [
            { number: { contains: q, mode: "insensitive" } },
            { customer: { name: { contains: q, mode: "insensitive" } } },
            { customerNameOnInvoice: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [records, total, completed] = await Promise.all([
    db.sale.findMany({
      where: { ...where, ...(params.status ? { status: params.status } : {}) },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        seller: { select: { name: true } },
        customer: { select: { name: true } },
        payments: { select: { method: true } },
        fiscalRange: { select: { prefix: true } },
      },
    }),
    db.sale.count({ where: { ...where, ...(params.status ? { status: params.status } : {}) } }),
    db.sale.aggregate({
      where: { ...where, status: "COMPLETED" },
      _count: { _all: true },
      _sum: { totalCents: true },
    }),
  ]);

  // Lo devuelto de las ventas de esta página: dos consultas cortas, no una por venta.
  const pageItems = await db.saleItem.findMany({
    where: { saleId: { in: records.map((sale) => sale.id) } },
    select: { id: true, saleId: true, quantity: true },
  });
  const returnedRows = await db.returnItem.groupBy({
    by: ["saleItemId"],
    where: { saleItemId: { in: pageItems.map((item) => item.id) } },
    _sum: { quantity: true },
  });
  const returnedByItem = new Map(
    returnedRows.map((row) => [row.saleItemId, row._sum.quantity ?? 0]),
  );
  const unitsOf = (saleId: string) =>
    pageItems
      .filter((item) => item.saleId === saleId)
      .reduce(
        (sum, item) => ({
          sold: sum.sold + item.quantity,
          returned: sum.returned + (returnedByItem.get(item.id) ?? 0),
        }),
        { sold: 0, returned: 0 },
      );

  return {
    rows: records.map((sale) => ({
      id: sale.id,
      number: sale.number,
      createdAt: sale.createdAt,
      sellerName: sale.seller.name,
      customerName: sale.customer?.name ?? sale.customerNameOnInvoice,
      totalCents: sale.totalCents,
      status: sale.status,
      fiscalNumber:
        sale.fiscalNumber !== null && sale.fiscalRange
          ? formatFiscalNumber(sale.fiscalRange.prefix, sale.fiscalNumber)
          : null,
      methods: [...new Set(sale.payments.map((payment) => payment.method))],
      soldUnits: unitsOf(sale.id).sold,
      returnedUnits: unitsOf(sale.id).returned,
    })),
    total,
    page,
    pageSize: PAGE_SIZE,
    completed: { count: completed._count._all, totalCents: completed._sum.totalCents ?? 0 },
  };
}

/** Las personas que pueden vender, para el filtro "Vendedor" de quien ve todas las ventas. */
export async function listSellers(): Promise<{ id: string; name: string }[]> {
  return db.user.findMany({
    where: { role: { in: ["OWNER", "MANAGER", "CASHIER"] } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}
