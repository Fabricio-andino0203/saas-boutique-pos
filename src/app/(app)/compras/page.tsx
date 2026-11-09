import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { NativeSelect } from "@/components/shared/native-select";
import { PageHeader } from "@/components/shared/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { messages } from "@/config/messages.es";
import type { PurchaseOrderStatus } from "@/generated/prisma/enums";
import { requirePageCapability } from "@/lib/auth";
import { formatLocalDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { hasCapability } from "@/lib/permissions";
import { OrderStatusBadge } from "@/modules/purchasing/components/status-badge";
import { listPurchaseOrders, listSupplierOptions } from "@/modules/purchasing/queries";

const STATUSES: readonly PurchaseOrderStatus[] = [
  "DRAFT",
  "ORDERED",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "CANCELLED",
];

const first = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? "";

export default async function PurchasesPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string; proveedor?: string; pagina?: string }>;
}) {
  const { user } = await requirePageCapability("purchase.receive");
  const raw = await searchParams;
  const status = STATUSES.find((value) => value === first(raw.estado));
  const supplierId = first(raw.proveedor);
  const page = Math.max(1, Number.parseInt(first(raw.pagina), 10) || 1);
  const showCost = hasCapability(user.role, "product.viewCost");

  const [list, suppliers] = await Promise.all([
    listPurchaseOrders({
      status,
      supplierId: supplierId || undefined,
      page,
      includeCost: showCost,
    }),
    listSupplierOptions(),
  ]);
  const copy = messages.purchasing;
  const heads = copy.columns;
  const filtered = Boolean(status || supplierId);
  const lastPage = Math.max(1, Math.ceil(list.total / list.pageSize));
  const pageHref = (target: number) => {
    const query = new URLSearchParams();
    if (status) query.set("estado", status);
    if (supplierId) query.set("proveedor", supplierId);
    if (target > 1) query.set("pagina", String(target));
    const text = query.toString();
    return text ? `/compras?${text}` : "/compras";
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={copy.title}
        actions={
          <>
            <Link href="/compras/recepciones" className={buttonVariants({ variant: "outline" })}>
              {copy.receipts}
            </Link>
            <Link
              href="/compras/recepciones/nueva"
              className={buttonVariants({ variant: showCost ? "outline" : "default" })}
            >
              {copy.receive}
            </Link>
            {showCost ? (
              <Link href="/compras/nueva" className={buttonVariants()}>
                {copy.newOrder}
              </Link>
            ) : null}
          </>
        }
      />

      <form method="get" role="search" className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <label htmlFor="po-status" className="text-sm font-medium">
            {copy.filters.status}
          </label>
          <NativeSelect id="po-status" name="estado" defaultValue={status ?? ""}>
            <option value="">{copy.filters.all}</option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {copy.status[value]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="po-supplier" className="text-sm font-medium">
            {copy.filters.supplier}
          </label>
          <NativeSelect id="po-supplier" name="proveedor" defaultValue={supplierId}>
            <option value="">{copy.filters.allSuppliers}</option>
            {suppliers.map((supplier) => (
              <option key={supplier.value} value={supplier.value}>
                {supplier.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit">{copy.filters.apply}</Button>
        {filtered ? (
          <Link href="/compras" className="text-muted-foreground py-1.5 text-sm underline">
            {copy.filters.clear}
          </Link>
        ) : null}
      </form>

      {list.rows.length === 0 ? (
        <EmptyState title={copy.empty.title} description={copy.empty.description} />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableCaption className="sr-only">{copy.title}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>{heads.number}</TableHead>
                <TableHead>{heads.supplier}</TableHead>
                <TableHead>{heads.status}</TableHead>
                <TableHead className="text-right">{heads.units}</TableHead>
                <TableHead className="text-right">{heads.received}</TableHead>
                {showCost ? <TableHead className="text-right">{heads.total}</TableHead> : null}
                <TableHead>{heads.date}</TableHead>
                <TableHead>{heads.expected}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Link
                      href={`/compras/${row.id}`}
                      className="text-primary font-medium underline underline-offset-4"
                    >
                      {row.number}
                    </Link>
                  </TableCell>
                  <TableCell>{row.supplierName}</TableCell>
                  <TableCell>
                    <OrderStatusBadge status={row.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{row.orderedUnits}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.receivedUnits}</TableCell>
                  {showCost ? (
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(row.totalCostCents ?? 0)}
                    </TableCell>
                  ) : null}
                  <TableCell>{formatLocalDateTime(row.createdAt)}</TableCell>
                  <TableCell>{row.expectedAt ?? ""}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <nav aria-label={copy.title} className="flex items-center justify-between gap-4 text-sm">
        <span className="text-muted-foreground">{list.total}</span>
        <div className="flex gap-4">
          {list.page > 1 ? (
            <Link href={pageHref(list.page - 1)} className="underline underline-offset-4">
              {messages.products.pagination.previous}
            </Link>
          ) : null}
          {list.page < lastPage ? (
            <Link href={pageHref(list.page + 1)} className="underline underline-offset-4">
              {messages.products.pagination.next}
            </Link>
          ) : null}
        </div>
      </nav>
    </div>
  );
}
