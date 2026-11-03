import Link from "next/link";

import { messages } from "@/config/messages.es";
import { formatMoney } from "@/lib/format";
import { ColumnChart } from "@/modules/reports/components/column-chart";
import { StatCard } from "@/modules/reports/components/stat-card";
import type { Dashboard } from "@/modules/reports/dashboard";
import { formatHour } from "@/modules/reports/labels";

const copy = messages.reports.dashboard;

type DashboardViewProps = {
  dashboard: Dashboard;
  /** Las piezas que dependen del rol: `null` si quien mira no las ve. */
  lowStock: number | null;
  cash: { open: boolean; expectedCents: number | null } | null;
};

/** El inicio del día: pocas tarjetas con lo importante, ventas por hora y lo más vendido (UX §7). */
export function DashboardView({ dashboard, lowStock, cash }: DashboardViewProps) {
  const { summary, hours, top } = dashboard;
  return (
    <section aria-labelledby="dashboard-title" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="dashboard-title" className="text-lg font-medium">
          {copy.title}
        </h2>
        <Link href="/reportes" className="text-primary text-sm underline underline-offset-4">
          {copy.viewReports}
        </Link>
      </div>

      <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label={copy.sales}
          value={formatMoney(summary.salesCents)}
          hint={
            summary.returnsCents > 0 ? `${copy.net}: ${formatMoney(summary.netCents)}` : undefined
          }
        />
        <StatCard label={copy.tickets} value={String(summary.tickets)} />
        <StatCard label={copy.average} value={formatMoney(summary.averageTicketCents)} />
        {summary.financial ? (
          <StatCard
            label={copy.profit}
            value={formatMoney(summary.financial.profitCents)}
            tone={summary.financial.profitCents >= 0 ? "good" : "bad"}
          />
        ) : null}
        {lowStock !== null ? (
          <StatCard
            label={copy.lowStock}
            value={String(lowStock)}
            tone={lowStock > 0 ? "bad" : "default"}
            hint={lowStock > 0 ? copy.lowStockHint : copy.lowStockOk}
          />
        ) : null}
        {cash ? (
          <StatCard
            label={copy.cash}
            value={
              cash.open && cash.expectedCents !== null
                ? formatMoney(cash.expectedCents)
                : copy.cashClosed
            }
            hint={cash.open ? copy.cashExpected : undefined}
          />
        ) : null}
      </div>

      {summary.tickets === 0 ? (
        <p role="status" className="text-muted-foreground text-sm">
          {copy.noSales}
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
          <section aria-labelledby="hours-title" className="space-y-2">
            <h3 id="hours-title" className="font-medium">
              {copy.byHour}
            </h3>
            <ColumnChart
              label={copy.byHour}
              items={hours.map((row) => ({ label: String(row.hour), value: row.salesCents }))}
              formatValue={formatMoney}
            />
            <ul className="sr-only">
              {hours
                .filter((row) => row.salesCents > 0)
                .map((row) => (
                  <li key={row.hour}>
                    {formatHour(row.hour)}: {formatMoney(row.salesCents)} ({row.tickets})
                  </li>
                ))}
            </ul>
          </section>
          <section aria-labelledby="top-title" className="space-y-2">
            <h3 id="top-title" className="font-medium">
              {copy.top}
            </h3>
            {top.length === 0 ? (
              <p className="text-muted-foreground text-sm">{copy.noSales}</p>
            ) : (
              <ol className="divide-y rounded-lg border text-sm">
                {top.map((row, index) => (
                  <li key={row.productId} className="flex items-center justify-between gap-3 p-3">
                    <span className="min-w-0">
                      <span className="text-muted-foreground mr-2 tabular-nums">{index + 1}.</span>
                      <span className="font-medium">{row.name}</span>
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {row.netUnits} {copy.units}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
