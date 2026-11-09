import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { ReturnForm } from "@/modules/returns/components/return-form";
import { getReturnableSale, searchSalesForReturn } from "@/modules/returns/queries";

const copy = messages.returns;

const first = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? "";

export default async function ReturnsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; venta?: string }>;
}) {
  const { user } = await requirePageCapability("return.create");
  const raw = await searchParams;
  const saleId = first(raw.venta);

  if (saleId) {
    const sale = await getReturnableSale(saleId);
    if (!sale) {
      notFound();
    }
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <PageHeader title={copy.title} />
        <ReturnForm
          sale={sale}
          canOverridePolicy={hasCapability(user.role, "return.overridePolicy")}
          canRefundCash={hasCapability(user.role, "return.refundCash")}
          canExchange={hasCapability(user.role, "sale.create")}
        />
      </div>
    );
  }

  const q = first(raw.q).trim();
  const sales = await searchSalesForReturn(q);
  const heads = copy.search.columns;

  return (
    <div className="space-y-6">
      <PageHeader title={copy.title} />
      <form method="get" role="search" className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-sm">
          <span className="font-medium">{copy.search.label}</span>
          <Input
            type="search"
            name="q"
            defaultValue={q}
            autoFocus
            autoComplete="off"
            placeholder={copy.search.placeholder}
            className="w-80"
          />
        </label>
        <Button type="submit">{copy.search.submit}</Button>
      </form>

      <h2 className="text-lg font-medium">{q ? copy.search.results : copy.search.recent}</h2>
      {sales.length === 0 ? (
        <EmptyState title={copy.search.empty} description="" />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableCaption className="sr-only">{copy.search.results}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>{heads.ticket}</TableHead>
                <TableHead>{heads.date}</TableHead>
                <TableHead>{heads.customer}</TableHead>
                <TableHead className="text-right">{heads.total}</TableHead>
                <TableHead>{heads.when}</TableHead>
                <TableHead>{heads.units}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sales.map((sale) => (
                <TableRow key={sale.id}>
                  <TableCell className="font-medium">{sale.number}</TableCell>
                  <TableCell>{formatLocalDateTime(sale.createdAt)}</TableCell>
                  <TableCell>{sale.customerName ?? messages.returns.sale.finalConsumer}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(sale.totalCents)}
                  </TableCell>
                  <TableCell>
                    {sale.daysSince === 0
                      ? copy.search.today
                      : `${copy.search.daysAgo} ${sale.daysSince} ${sale.daysSince === 1 ? copy.search.day : copy.search.days}`}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {sale.units}
                    {sale.returnedUnits > 0
                      ? ` (${sale.returnedUnits} ${copy.search.returnedOf})`
                      : ""}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/devoluciones?venta=${sale.id}`}
                      aria-label={`${copy.search.choose} ${sale.number}`}
                      className="text-primary font-medium underline underline-offset-4"
                    >
                      {copy.search.choose}
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
