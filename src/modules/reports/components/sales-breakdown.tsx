import { EmptyState } from "@/components/shared/empty-state";
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
import { formatMoney, formatPercentBps } from "@/lib/format";
import { ColumnChart } from "@/modules/reports/components/column-chart";
import { formatHour, formatPeriodKey } from "@/modules/reports/labels";
import type {
  SalesCashierRow,
  SalesDimensionRow,
  SalesHourRow,
  SalesMethodRow,
  SalesPeriodRow,
} from "@/modules/reports/queries";

const copy = messages.reports.sales;
const cols = copy.columns;
const common = messages.reports.common;

const money = "text-right tabular-nums";
const methodName = (method: string): string =>
  messages.cash.methods[method as keyof typeof messages.cash.methods] ?? method;

function Empty() {
  return <EmptyState title={common.empty} description={common.emptyHint} />;
}

export function PeriodBreakdown({
  rows,
  granularity,
}: {
  rows: SalesPeriodRow[];
  granularity: "day" | "month";
}) {
  if (rows.length === 0) {
    return <Empty />;
  }
  return (
    <div className="space-y-4">
      <ColumnChart
        label={copy.charts.period}
        items={rows.map((row) => ({
          label: granularity === "day" ? row.key.slice(8) : formatPeriodKey(row.key).slice(0, 3),
          value: row.netCents,
        }))}
        formatValue={formatMoney}
      />
      <Table>
        <TableCaption className="sr-only">{copy.by.period}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>{cols.period}</TableHead>
            <TableHead className="text-right">{cols.tickets}</TableHead>
            <TableHead className="text-right">{cols.sales}</TableHead>
            <TableHead className="text-right">{cols.returns}</TableHead>
            <TableHead className="text-right">{cols.net}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...rows].reverse().map((row) => (
            <TableRow key={row.key}>
              <TableCell>{formatPeriodKey(row.key)}</TableCell>
              <TableCell className={money}>{row.tickets}</TableCell>
              <TableCell className={money}>{formatMoney(row.salesCents)}</TableCell>
              <TableCell className={money}>{formatMoney(row.returnsCents)}</TableCell>
              <TableCell className={`${money} font-medium`}>{formatMoney(row.netCents)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function HourBreakdown({ rows }: { rows: SalesHourRow[] }) {
  if (rows.length === 0) {
    return <Empty />;
  }
  return (
    <div className="space-y-4">
      <ColumnChart
        label={copy.charts.hour}
        items={rows.map((row) => ({ label: String(row.hour), value: row.salesCents }))}
        formatValue={formatMoney}
      />
      <Table>
        <TableCaption className="sr-only">{copy.by.hour}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>{cols.hour}</TableHead>
            <TableHead className="text-right">{cols.tickets}</TableHead>
            <TableHead className="text-right">{cols.sales}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.hour}>
              <TableCell>{formatHour(row.hour)}</TableCell>
              <TableCell className={money}>{row.tickets}</TableCell>
              <TableCell className={money}>{formatMoney(row.salesCents)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function CashierBreakdown({ rows }: { rows: SalesCashierRow[] }) {
  if (rows.length === 0) {
    return <Empty />;
  }
  return (
    <Table>
      <TableCaption className="sr-only">{copy.by.cashier}</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>{cols.cashier}</TableHead>
          <TableHead className="text-right">{cols.tickets}</TableHead>
          <TableHead className="text-right">{cols.sales}</TableHead>
          <TableHead className="text-right">{cols.average}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.sellerId}>
            <TableCell>{row.sellerName}</TableCell>
            <TableCell className={money}>{row.tickets}</TableCell>
            <TableCell className={money}>{formatMoney(row.salesCents)}</TableCell>
            <TableCell className={money}>{formatMoney(row.averageTicketCents)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function DimensionBreakdown({
  rows,
  dimension,
}: {
  rows: SalesDimensionRow[];
  dimension: "category" | "brand";
}) {
  if (rows.length === 0) {
    return <Empty />;
  }
  const financial = rows.some((row) => row.financial !== null);
  return (
    <Table>
      <TableCaption className="sr-only">{copy.by[dimension]}</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>{dimension === "category" ? cols.category : cols.brand}</TableHead>
          <TableHead className="text-right">{cols.units}</TableHead>
          <TableHead className="text-right">{cols.sales}</TableHead>
          <TableHead className="text-right">{cols.returns}</TableHead>
          <TableHead className="text-right">{cols.net}</TableHead>
          {financial ? (
            <>
              <TableHead className="text-right">{cols.revenue}</TableHead>
              <TableHead className="text-right">{cols.profit}</TableHead>
              <TableHead className="text-right">{cols.margin}</TableHead>
            </>
          ) : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.key}>
            <TableCell>{row.name || common.noBrand}</TableCell>
            <TableCell className={money}>{row.units}</TableCell>
            <TableCell className={money}>{formatMoney(row.soldCents)}</TableCell>
            <TableCell className={money}>{formatMoney(row.returnedCents)}</TableCell>
            <TableCell className={`${money} font-medium`}>{formatMoney(row.netCents)}</TableCell>
            {row.financial ? (
              <>
                <TableCell className={money}>{formatMoney(row.financial.revenueCents)}</TableCell>
                <TableCell className={money}>{formatMoney(row.financial.profitCents)}</TableCell>
                <TableCell className={money}>
                  {formatPercentBps(row.financial.marginBps)} %
                </TableCell>
              </>
            ) : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function MethodBreakdown({
  methods,
  refunds,
}: {
  methods: SalesMethodRow[];
  refunds: { method: string; amountCents: number }[];
}) {
  if (methods.length === 0) {
    return <Empty />;
  }
  return (
    <div className="space-y-6">
      <Table>
        <TableCaption className="sr-only">{copy.by.method}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>{cols.method}</TableHead>
            <TableHead className="text-right">{cols.tickets}</TableHead>
            <TableHead className="text-right">{cols.amount}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {methods.map((row) => (
            <TableRow key={row.method}>
              <TableCell>{methodName(row.method)}</TableCell>
              <TableCell className={money}>{row.tickets}</TableCell>
              <TableCell className={`${money} font-medium`}>
                {formatMoney(row.amountCents)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-muted-foreground text-sm">{copy.methodNote}</p>
      {refunds.length > 0 ? (
        <section aria-labelledby="refunds-title" className="space-y-2">
          <h3 id="refunds-title" className="font-medium">
            {copy.refundsTitle}
          </h3>
          <ul className="divide-y rounded-lg border text-sm">
            {refunds.map((row) => (
              <li key={row.method} className="flex justify-between gap-2 p-3">
                <span>
                  {messages.returns.methods[row.method as keyof typeof messages.returns.methods] ??
                    row.method}
                </span>
                <span className="font-medium tabular-nums">{formatMoney(row.amountCents)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
