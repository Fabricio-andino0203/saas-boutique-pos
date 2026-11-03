import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { messages } from "@/config/messages.es";
import { requirePageCapability } from "@/lib/auth";
import { formatMoney, formatPercentBps } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FinanceExportLinks } from "@/modules/finance/components/finance-export-links";
import { getFinanceSummary, listFixedCosts } from "@/modules/finance/queries";
import { RangeFilter } from "@/modules/reports/components/range-filter";
import { StatFigure } from "@/modules/reports/components/stat-card";
import { parseRange } from "@/modules/reports/ranges";

const copy = messages.finance.summary;

const first = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? "";

export default async function FinanceSummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ rango?: string; desde?: string; hasta?: string }>;
}) {
  await requirePageCapability("finance.view");
  const raw = await searchParams;
  const range = parseRange({
    rango: first(raw.rango),
    desde: first(raw.desde),
    hasta: first(raw.hasta),
  });
  const [summary, fixed] = await Promise.all([getFinanceSummary(range), listFixedCosts()]);
  const pendingTotal = fixed.pending.reduce((total, row) => total + row.amountCents, 0);
  const exportParams = range.preset
    ? { rango: range.preset }
    : { desde: range.fromKey, hasta: range.toKey };
  const profit = summary.netProfitCents;

  const rows: {
    key: string;
    label: string;
    cents: number;
    kind: "line" | "sub" | "total";
    sign?: "+" | "−";
  }[] = [
    { key: "revenue", label: copy.lines.revenue, cents: summary.revenueCents, kind: "line" },
    {
      key: "cost",
      label: copy.lines.cost,
      cents: summary.costOfSalesCents,
      kind: "line",
      sign: "−",
    },
    { key: "gross", label: copy.lines.gross, cents: summary.grossProfitCents, kind: "total" },
    {
      key: "income",
      label: copy.lines.otherIncome,
      cents: summary.otherIncomeCents,
      kind: "line",
      sign: "+",
    },
    ...summary.incomeLines.map((line) => ({
      key: `income-${line.categoryId}`,
      label: line.name,
      cents: line.totalCents,
      kind: "sub" as const,
    })),
    {
      key: "expenses",
      label: copy.lines.expenses,
      cents: summary.expensesCents,
      kind: "line",
      sign: "−",
    },
    ...summary.expenseLines.map((line) => ({
      key: `expense-${line.categoryId}`,
      label: line.name,
      cents: line.totalCents,
      kind: "sub" as const,
    })),
    { key: "net", label: copy.lines.net, cents: summary.netProfitCents, kind: "total" },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title={copy.title}
        description={copy.description}
        actions={<FinanceExportLinks kind="resumen" params={exportParams} />}
      />

      <RangeFilter path="/finanzas" range={range} />

      <div className="stagger border-divider grid gap-6 border-b pb-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:items-end">
        <div role="group" aria-label={copy.netProfit} className="space-y-2">
          <p className="text-muted-foreground text-sm">{copy.netProfit}</p>
          <p
            className={cn(
              "font-heading text-4xl font-bold tracking-tight tabular-nums sm:text-5xl",
              profit >= 0 ? "text-heading" : "text-destructive",
            )}
          >
            {formatMoney(profit)}
          </p>
          {summary.revenueCents > 0 ? (
            <p className="text-muted-foreground text-sm tabular-nums">
              {formatPercentBps(summary.netMarginBps)} % {copy.margin}
            </p>
          ) : null}
        </div>
        <div className="grid gap-6 sm:grid-cols-2">
          <StatFigure
            label={copy.figures.revenue}
            value={formatMoney(summary.revenueCents)}
            hint={copy.figures.revenueHint}
            divided={false}
          />
          <StatFigure
            divided={false}
            label={copy.figures.gross}
            value={formatMoney(summary.grossProfitCents)}
            hint={
              summary.revenueCents > 0
                ? `${formatPercentBps(summary.grossMarginBps)} % ${copy.margin}`
                : undefined
            }
          />
          <StatFigure
            divided={false}
            label={copy.figures.otherIncome}
            value={formatMoney(summary.otherIncomeCents)}
          />
          <StatFigure
            divided={false}
            label={copy.figures.expenses}
            value={formatMoney(summary.expensesCents)}
          />
        </div>
      </div>

      <section aria-labelledby="statement-title" className="space-y-3">
        <h2 id="statement-title" className="text-lg font-medium">
          {copy.statementTitle}
        </h2>
        <div className="bg-card overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{copy.columns.concept}</TableHead>
                <TableHead className="text-right">{copy.columns.amount}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.key} className={cn(row.kind === "total" && "bg-muted/40")}>
                  <TableCell
                    className={cn(
                      row.kind === "sub" && "text-muted-foreground pl-8",
                      row.kind === "total" && "font-semibold",
                    )}
                  >
                    {row.label}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right tabular-nums",
                      row.kind === "sub" && "text-muted-foreground",
                      row.kind === "total" && "font-semibold",
                      row.key === "net" && profit < 0 && "text-destructive",
                    )}
                  >
                    {row.sign ? `${row.sign} ` : ""}
                    {formatMoney(row.cents)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {summary.incomeLines.length === 0 && summary.expenseLines.length === 0 ? (
          <p role="status" className="text-muted-foreground text-sm">
            {copy.noMovements}
          </p>
        ) : null}
        <p className="text-muted-foreground text-xs">{copy.note}</p>
      </section>

      <section aria-labelledby="pending-title" className="space-y-2">
        <h2 id="pending-title" className="text-lg font-medium">
          {copy.pendingTitle}
        </h2>
        {fixed.pending.length === 0 ? (
          <p className="text-muted-foreground text-sm">{copy.pendingNone}</p>
        ) : (
          <p className="text-sm tabular-nums">
            {fixed.pending.length} {fixed.pending.length === 1 ? copy.pendingOne : copy.pendingMany}{" "}
            {copy.pendingTotal} <span className="font-medium">{formatMoney(pendingTotal)}</span>
          </p>
        )}
        <Link
          href="/finanzas/costos-fijos"
          className="text-primary text-sm underline underline-offset-4"
        >
          {copy.pendingLink}
        </Link>
      </section>
    </div>
  );
}
