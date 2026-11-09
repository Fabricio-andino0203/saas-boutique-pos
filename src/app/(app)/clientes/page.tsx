import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
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
import { listCustomers } from "@/modules/customers/queries";

const copy = messages.customers.list;

const first = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? "";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; archivados?: string; pagina?: string }>;
}) {
  const { user } = await requirePageCapability("customer.view");
  const raw = await searchParams;
  const q = first(raw.q).trim();
  const includeArchived = first(raw.archivados) === "1";
  const page = Math.max(1, Number.parseInt(first(raw.pagina), 10) || 1);
  const list = await listCustomers({ q, includeArchived, page });
  const lastPage = Math.max(1, Math.ceil(list.total / list.pageSize));
  const heads = copy.columns;

  const href = (next: { page?: number; archived?: boolean }) => {
    const query = new URLSearchParams();
    if (q) query.set("q", q);
    if (next.archived ?? includeArchived) query.set("archivados", "1");
    if (next.page && next.page > 1) query.set("pagina", String(next.page));
    return `/clientes${query.size > 0 ? `?${query.toString()}` : ""}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={copy.title}
        actions={
          hasCapability(user.role, "customer.write") ? (
            <Link href="/clientes/nuevo" className={buttonVariants()}>
              {copy.new}
            </Link>
          ) : null
        }
      />

      <form method="get" role="search" className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-sm font-medium">
          {copy.search.label}
          <Input
            name="q"
            defaultValue={q}
            placeholder={copy.search.placeholder}
            autoComplete="off"
            className="w-72"
          />
        </label>
        {includeArchived ? <input type="hidden" name="archivados" value="1" /> : null}
        <Button type="submit">{copy.search.submit}</Button>
        <Link
          href={href({ archived: !includeArchived })}
          className={buttonVariants({ variant: "ghost" })}
        >
          {includeArchived ? copy.search.hideArchived : copy.search.showArchived}
        </Link>
      </form>

      {list.rows.length === 0 ? (
        <EmptyState title={copy.empty} description={copy.emptyHint} />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableCaption className="sr-only">{copy.results}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>{heads.name}</TableHead>
                <TableHead>{heads.phone}</TableHead>
                <TableHead>{heads.email}</TableHead>
                <TableHead className="text-right">{heads.credit}</TableHead>
                <TableHead className="text-right">{heads.purchases}</TableHead>
                <TableHead>{heads.last}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Link
                      href={`/clientes/${row.id}`}
                      className="text-primary font-medium underline underline-offset-4"
                      aria-label={`${copy.open} ${row.name}`}
                    >
                      {row.name}
                    </Link>
                    {row.archived ? (
                      <span className="bg-muted text-muted-foreground ml-2 rounded px-1.5 py-0.5 text-xs">
                        {copy.archivedBadge}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>{row.phone ?? "—"}</TableCell>
                  <TableCell>{row.email ?? "—"}</TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${row.storeCreditCents > 0 ? "text-success font-medium" : ""}`}
                  >
                    {formatMoney(row.storeCreditCents)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{row.salesCount}</TableCell>
                  <TableCell>
                    {row.lastSaleAt ? formatLocalDateTime(row.lastSaleAt) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {lastPage > 1 ? (
        <nav
          aria-label={copy.pagination.page}
          className="flex items-center justify-between text-sm"
        >
          {page > 1 ? (
            <Link href={href({ page: page - 1 })} className="underline">
              {copy.pagination.previous}
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted-foreground">
            {page} / {lastPage}
          </span>
          {page < lastPage ? (
            <Link href={href({ page: page + 1 })} className="underline">
              {copy.pagination.next}
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}
