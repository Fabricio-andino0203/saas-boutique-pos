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
import { listLayaways, type LayawayRow } from "@/modules/layaways/queries";
import { expireOverdueLayaways } from "@/modules/layaways/service";

const copy = messages.layaways;

const first = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? "";

function dueText(row: LayawayRow): string {
  if (row.status !== "ACTIVE") {
    return formatLocalDateTime(row.expiresAt);
  }
  const t = copy.list;
  if (row.daysLeft === 0) {
    return `${t.today}`;
  }
  if (row.daysLeft < 0) {
    const days = Math.abs(row.daysLeft);
    return `${t.overdueBefore} ${days} ${days === 1 ? t.day : t.days}`;
  }
  return `${t.expiresIn} ${row.daysLeft} ${row.daysLeft === 1 ? t.day : t.days}`;
}

export default async function LayawaysPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; todos?: string }>;
}) {
  const { user } = await requirePageCapability("layaway.manage");
  // Lo que ya venció se cierra al abrir la lista: las prendas vuelven a estar disponibles y el abono pasa a crédito.
  await expireOverdueLayaways(user);

  const raw = await searchParams;
  const q = first(raw.q).trim();
  const all = first(raw.todos) === "1";
  const rows = await listLayaways({ q, onlyActive: !all });
  const heads = copy.list.columns;
  const toggle = new URLSearchParams();
  if (q) toggle.set("q", q);
  if (!all) toggle.set("todos", "1");

  return (
    <div className="space-y-6">
      <PageHeader title={copy.title} />
      <p className="text-muted-foreground text-sm">{copy.newHint}</p>

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
        {all ? <input type="hidden" name="todos" value="1" /> : null}
        <Button type="submit">{copy.search.submit}</Button>
        <Link
          href={`/apartados${toggle.size > 0 ? `?${toggle.toString()}` : ""}`}
          className={buttonVariants({ variant: "ghost" })}
        >
          {all ? copy.search.showActive : copy.search.showAll}
        </Link>
      </form>

      {rows.length === 0 ? (
        <EmptyState title={copy.list.empty} description={copy.newHint} />
      ) : (
        <Table>
          <TableCaption className="sr-only">{copy.list.results}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{heads.number}</TableHead>
              <TableHead>{heads.customer}</TableHead>
              <TableHead className="text-right">{heads.total}</TableHead>
              <TableHead className="text-right">{heads.paid}</TableHead>
              <TableHead className="text-right">{heads.balance}</TableHead>
              <TableHead>{heads.expires}</TableHead>
              <TableHead>{heads.status}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <Link
                    href={`/apartados/${row.id}`}
                    className="text-primary font-medium underline underline-offset-4"
                    aria-label={`${copy.list.open} ${row.number}`}
                  >
                    {row.number}
                  </Link>
                </TableCell>
                <TableCell>{row.customerName}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(row.totalCents)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(row.paidCents)}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {row.status === "ACTIVE" ? formatMoney(row.balanceCents) : "—"}
                </TableCell>
                <TableCell
                  className={
                    row.status === "ACTIVE" && row.daysLeft <= 3 ? "text-warning" : undefined
                  }
                >
                  {dueText(row)}
                </TableCell>
                <TableCell>{copy.status[row.status]}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
