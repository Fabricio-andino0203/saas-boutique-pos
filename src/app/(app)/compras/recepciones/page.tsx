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
import { requirePageCapability } from "@/lib/auth";
import { formatLocalDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { hasCapability } from "@/lib/permissions";
import { listReceipts, listSupplierOptions } from "@/modules/purchasing/queries";

const first = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? "";

export default async function ReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<{ proveedor?: string; pagina?: string }>;
}) {
  const { user } = await requirePageCapability("purchase.receive");
  const raw = await searchParams;
  const supplierId = first(raw.proveedor);
  const page = Math.max(1, Number.parseInt(first(raw.pagina), 10) || 1);
  const showCost = hasCapability(user.role, "product.viewCost");

  const [list, suppliers] = await Promise.all([
    listReceipts({ supplierId: supplierId || undefined, page, includeCost: showCost }),
    listSupplierOptions(),
  ]);
  const copy = messages.purchasing;
  const heads = copy.columns;
  const lastPage = Math.max(1, Math.ceil(list.total / list.pageSize));
  const pageHref = (target: number) => {
    const query = new URLSearchParams();
    if (supplierId) query.set("proveedor", supplierId);
    if (target > 1) query.set("pagina", String(target));
    const text = query.toString();
    return text ? `/compras/recepciones?${text}` : "/compras/recepciones";
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={copy.receipts}
        description={copy.receipt.description}
        actions={
          <>
            <Link href="/compras" className={buttonVariants({ variant: "outline" })}>
              {copy.title}
            </Link>
            <Link href="/compras/recepciones/nueva" className={buttonVariants()}>
              {copy.receive}
            </Link>
          </>
        }
      />

      <form method="get" role="search" className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <label htmlFor="rc-supplier" className="text-sm font-medium">
            {copy.filters.supplier}
          </label>
          <NativeSelect id="rc-supplier" name="proveedor" defaultValue={supplierId}>
            <option value="">{copy.filters.allSuppliers}</option>
            {suppliers.map((supplier) => (
              <option key={supplier.value} value={supplier.value}>
                {supplier.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit">{copy.filters.apply}</Button>
        {supplierId ? (
          <Link
            href="/compras/recepciones"
            className="text-muted-foreground py-1.5 text-sm underline"
          >
            {copy.filters.clear}
          </Link>
        ) : null}
      </form>

      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="bg-card rounded-lg border p-4">
          <dt className="text-muted-foreground text-sm">{copy.receipts}</dt>
          <dd className="text-xl font-semibold tabular-nums">{list.total}</dd>
        </div>
        <div className="bg-card rounded-lg border p-4">
          <dt className="text-muted-foreground text-sm">{heads.units}</dt>
          <dd className="text-xl font-semibold tabular-nums">{list.totals.units}</dd>
        </div>
        {list.totals.costCents !== null ? (
          <div className="bg-card rounded-lg border p-4">
            <dt className="text-muted-foreground text-sm">{heads.total}</dt>
            <dd className="text-xl font-semibold tabular-nums">
              {formatMoney(list.totals.costCents)}
            </dd>
          </div>
        ) : null}
      </dl>

      {list.rows.length === 0 ? (
        <EmptyState title={copy.emptyReceipts.title} description={copy.emptyReceipts.description} />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableCaption className="sr-only">{copy.receipts}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>{heads.number}</TableHead>
                <TableHead>{heads.date}</TableHead>
                <TableHead>{heads.supplier}</TableHead>
                <TableHead>{heads.invoice}</TableHead>
                <TableHead>{heads.order}</TableHead>
                <TableHead>{heads.user}</TableHead>
                <TableHead className="text-right">{heads.units}</TableHead>
                {showCost ? <TableHead className="text-right">{heads.total}</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Link
                      href={`/compras/recepciones/${row.id}`}
                      className="text-primary font-medium underline underline-offset-4"
                    >
                      {row.number}
                    </Link>
                  </TableCell>
                  <TableCell>{formatLocalDateTime(row.receivedAt)}</TableCell>
                  <TableCell>{row.supplierName}</TableCell>
                  <TableCell>{row.supplierInvoiceRef}</TableCell>
                  <TableCell>{row.orderNumber ?? ""}</TableCell>
                  <TableCell>{row.receivedByName}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.units}</TableCell>
                  {showCost ? (
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(row.totalCostCents ?? 0)}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <nav aria-label={copy.receipts} className="flex items-center justify-between gap-4 text-sm">
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
