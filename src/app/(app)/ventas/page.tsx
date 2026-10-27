import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { NativeSelect } from "@/components/shared/native-select";
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
import { formatLocalDateTime, localDateKey } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { hasCapability } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { listSales, listSellers } from "@/modules/sales/list-queries";

const copy = messages.salesHistory;

type SearchParams = {
  desde?: string;
  hasta?: string;
  estado?: string;
  vendedor?: string;
  q?: string;
  pagina?: string;
};

const first = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? "";

export default async function SalesHistoryPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { user } = await requirePageCapability("sale.create");
  const raw = await searchParams;
  const seeAll = hasCapability(user.role, "cash.viewOthers");

  // Sin fechas en la dirección se muestran las de hoy; una fecha vacía significa "sin límite".
  const today = localDateKey(new Date());
  const from = raw.desde === undefined ? today : first(raw.desde);
  const to = raw.hasta === undefined ? today : first(raw.hasta);
  const status =
    first(raw.estado) === "COMPLETED" || first(raw.estado) === "VOIDED"
      ? (first(raw.estado) as "COMPLETED" | "VOIDED")
      : undefined;
  const sellerId = seeAll ? first(raw.vendedor) : "";
  const q = first(raw.q).trim();
  const page = Math.max(1, Number.parseInt(first(raw.pagina), 10) || 1);

  const [sales, sellers] = await Promise.all([
    listSales(
      { from, to, status, sellerId: sellerId || undefined, q, page },
      seeAll ? {} : { onlySellerId: user.id },
    ),
    seeAll ? listSellers() : Promise.resolve([]),
  ]);
  const lastPage = Math.max(1, Math.ceil(sales.total / sales.pageSize));
  const heads = copy.columns;

  const href = (target: number) => {
    const query = new URLSearchParams({ desde: from, hasta: to });
    if (status) query.set("estado", status);
    if (sellerId) query.set("vendedor", sellerId);
    if (q) query.set("q", q);
    if (target > 1) query.set("pagina", String(target));
    return `/ventas?${query.toString()}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={copy.title}
        description={seeAll ? copy.description : copy.descriptionOwn}
      />

      <form method="get" className="flex flex-wrap items-end gap-3" role="search">
        <label className="space-y-1 text-sm">
          <span className="font-medium">{copy.filters.from}</span>
          <Input type="date" name="desde" defaultValue={from} className="w-40" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">{copy.filters.to}</span>
          <Input type="date" name="hasta" defaultValue={to} className="w-40" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">{copy.filters.status}</span>
          <NativeSelect name="estado" defaultValue={status ?? ""} className="w-40">
            <option value="">{copy.filters.all}</option>
            <option value="COMPLETED">{copy.status.COMPLETED}</option>
            <option value="VOIDED">{copy.status.VOIDED}</option>
          </NativeSelect>
        </label>
        {seeAll ? (
          <label className="space-y-1 text-sm">
            <span className="font-medium">{copy.filters.seller}</span>
            <NativeSelect name="vendedor" defaultValue={sellerId} className="w-48">
              <option value="">{copy.filters.everyone}</option>
              {sellers.map((seller) => (
                <option key={seller.id} value={seller.id}>
                  {seller.name}
                </option>
              ))}
            </NativeSelect>
          </label>
        ) : null}
        <label className="space-y-1 text-sm">
          <span className="font-medium">{copy.filters.search}</span>
          <Input
            type="search"
            name="q"
            defaultValue={q}
            placeholder={copy.filters.searchHint}
            className="w-56"
          />
        </label>
        <Button type="submit">{copy.filters.apply}</Button>
        <Link
          href="/ventas"
          className="text-primary self-center text-sm underline underline-offset-4"
        >
          {copy.filters.today}
        </Link>
      </form>

      <p className="text-muted-foreground text-sm" role="status">
        <span className="text-foreground font-semibold tabular-nums">{sales.completed.count}</span>{" "}
        {copy.summary.sales} ·{" "}
        <span className="text-foreground font-semibold tabular-nums">
          {formatMoney(sales.completed.totalCents)}
        </span>{" "}
        {copy.summary.sold}
      </p>

      {sales.rows.length === 0 ? (
        <EmptyState title={copy.empty.title} description={copy.empty.description} />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableCaption className="sr-only">{copy.title}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>{heads.ticket}</TableHead>
                <TableHead>{heads.date}</TableHead>
                <TableHead>{heads.seller}</TableHead>
                <TableHead>{heads.customer}</TableHead>
                <TableHead>{heads.payment}</TableHead>
                <TableHead className="text-right">{heads.total}</TableHead>
                <TableHead>{heads.status}</TableHead>
                <TableHead>{heads.invoice}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sales.rows.map((sale) => (
                <TableRow key={sale.id}>
                  <TableCell>
                    <Link
                      href={`/ventas/${sale.id}`}
                      className="text-primary font-medium underline underline-offset-4"
                    >
                      {sale.number}
                    </Link>
                  </TableCell>
                  <TableCell>{formatLocalDateTime(sale.createdAt)}</TableCell>
                  <TableCell>{sale.sellerName}</TableCell>
                  <TableCell>{sale.customerName ?? copy.finalConsumer}</TableCell>
                  <TableCell>
                    {sale.methods.map((method) => messages.cash.methods[method]).join(" + ")}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right tabular-nums",
                      sale.status === "VOIDED" && "text-muted-foreground line-through",
                    )}
                  >
                    {formatMoney(sale.totalCents)}
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-xs font-medium",
                        sale.status === "VOIDED"
                          ? "bg-destructive/10 text-destructive"
                          : "bg-success/15 text-success",
                      )}
                    >
                      {copy.status[sale.status]}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs tabular-nums">{sale.fiscalNumber ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {lastPage > 1 ? (
        <nav
          aria-label={messages.audit.pagination.next}
          className="flex items-center justify-between text-sm"
        >
          {page > 1 ? (
            <Link href={href(page - 1)} className="underline">
              {messages.audit.pagination.previous}
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted-foreground">
            {page} / {lastPage}
          </span>
          {page < lastPage ? (
            <Link href={href(page + 1)} className="underline">
              {messages.audit.pagination.next}
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}
