import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
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
import { RangeFilter } from "@/modules/reports/components/range-filter";
import { StatCard } from "@/modules/reports/components/stat-card";
import { getCashClosings } from "@/modules/reports/queries";
import { parseRange } from "@/modules/reports/ranges";

const copy = messages.reports.closings;

const first = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? "";

export default async function ClosingsReportPage({
  searchParams,
}: {
  searchParams: Promise<{ rango?: string; desde?: string; hasta?: string }>;
}) {
  await requirePageCapability("cash.viewOthers");
  const raw = await searchParams;
  const range = parseRange({
    rango: first(raw.rango),
    desde: first(raw.desde),
    hasta: first(raw.hasta),
  });
  const closings = await getCashClosings(range);
  const num = "text-right tabular-nums";

  return (
    <div className="space-y-6">
      <PageHeader title={copy.title} description={messages.reports.index.closings.description} />
      <RangeFilter path="/reportes/cierres" range={range} />

      <section aria-label={copy.title} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={copy.cards.count} value={String(closings.count)} />
        <StatCard label={copy.cards.withDifference} value={String(closings.withDifference)} />
        <StatCard
          label={copy.cards.short}
          value={formatMoney(closings.shortCents)}
          tone={closings.shortCents > 0 ? "bad" : "default"}
        />
        <StatCard label={copy.cards.over} value={formatMoney(closings.overCents)} />
      </section>

      {closings.rows.length === 0 ? (
        <EmptyState
          title={messages.reports.common.empty}
          description={messages.reports.common.emptyHint}
        />
      ) : (
        <Table>
          <TableCaption className="sr-only">{copy.title}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{copy.columns.closedAt}</TableHead>
              <TableHead>{copy.columns.terminal}</TableHead>
              <TableHead>{copy.columns.user}</TableHead>
              <TableHead className="text-right">{copy.columns.expected}</TableHead>
              <TableHead className="text-right">{copy.columns.counted}</TableHead>
              <TableHead className="text-right">{copy.columns.difference}</TableHead>
              <TableHead>{copy.columns.status}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {closings.rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <Link
                    href={`/caja/cierres/${row.id}`}
                    className="text-primary underline underline-offset-4"
                    aria-label={`${copy.open} ${formatLocalDateTime(row.closedAt)}`}
                  >
                    {formatLocalDateTime(row.closedAt)}
                  </Link>
                </TableCell>
                <TableCell>{row.terminalName}</TableCell>
                <TableCell>{row.userName}</TableCell>
                <TableCell className={num}>{formatMoney(row.expectedCents)}</TableCell>
                <TableCell className={num}>{formatMoney(row.countedCents)}</TableCell>
                <TableCell
                  className={`${num} font-medium ${row.differenceCents < 0 ? "text-destructive" : row.differenceCents > 0 ? "text-success" : ""}`}
                >
                  {row.differenceCents > 0 ? "+" : ""}
                  {formatMoney(row.differenceCents)}
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
