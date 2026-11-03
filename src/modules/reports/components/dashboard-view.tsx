import Link from "next/link";

import { TicketCard } from "@/components/shared/ticket-card";
import { messages } from "@/config/messages.es";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ColumnChart } from "@/modules/reports/components/column-chart";
import { StatFigure } from "@/modules/reports/components/stat-card";
import type { Dashboard } from "@/modules/reports/dashboard";
import { formatHour } from "@/modules/reports/labels";

const copy = messages.reports.dashboard;

type DashboardViewProps = {
  dashboard: Dashboard;
  /** Las piezas que dependen del rol: `null` si quien mira no las ve. */
  lowStock: number | null;
  cash: { open: boolean; expectedCents: number | null } | null;
};

/**
 * El inicio del día (UX §7): la cifra de ventas en grande junto a las ventas por hora, una fila de indicadores separados por
 * líneas finas en vez de tarjetas, lo más vendido y la caja como boleto.
 */
export function DashboardView({ dashboard, lowStock, cash }: DashboardViewProps) {
  const { summary, hours, top } = dashboard;
  const hasSales = summary.tickets > 0;

  return (
    <section aria-labelledby="dashboard-title" className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="dashboard-title" className="text-lg font-medium">
          {copy.title}
        </h2>
        <Link href="/reportes" className="text-primary text-sm underline underline-offset-4">
          {copy.viewReports}
        </Link>
      </div>

      <div className="stagger border-divider grid gap-6 border-b pb-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] lg:items-end">
        <div role="group" aria-label={copy.sales} className="space-y-2">
          <p className="text-muted-foreground text-sm">{copy.sales}</p>
          <p className="font-heading text-heading text-4xl font-bold tracking-tight tabular-nums sm:text-5xl">
            {formatMoney(summary.salesCents)}
          </p>
          {summary.returnsCents > 0 ? (
            <p className="text-muted-foreground text-sm tabular-nums">
              {copy.net}: {formatMoney(summary.netCents)}
            </p>
          ) : null}
        </div>
        {hasSales ? (
          <section aria-labelledby="hours-title" className="space-y-2">
            <h3 id="hours-title" className="text-sm font-medium">
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
        ) : (
          <p role="status" className="text-muted-foreground text-sm">
            {copy.noSales}
          </p>
        )}
      </div>

      <div className="stagger border-divider grid gap-6 border-b pb-6 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]">
        <StatFigure label={copy.tickets} value={String(summary.tickets)} />
        <StatFigure label={copy.average} value={formatMoney(summary.averageTicketCents)} />
        {summary.financial ? (
          <StatFigure
            label={copy.profit}
            value={formatMoney(summary.financial.profitCents)}
            tone={summary.financial.profitCents >= 0 ? "good" : "bad"}
          />
        ) : null}
        {lowStock !== null ? (
          <StatFigure
            label={copy.lowStock}
            value={String(lowStock)}
            tone={lowStock > 0 ? "bad" : "default"}
            hint={lowStock > 0 ? copy.lowStockHint : copy.lowStockOk}
          />
        ) : null}
      </div>

      {hasSales || cash ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
          {hasSales ? (
            <section aria-labelledby="top-title" className="space-y-2">
              <h3 id="top-title" className="text-sm font-medium">
                {copy.top}
              </h3>
              {top.length === 0 ? (
                <p className="text-muted-foreground text-sm">{copy.noSales}</p>
              ) : (
                <ol className="divide-divider bg-card divide-y rounded-lg border text-sm">
                  {top.map((row, index) => (
                    <li key={row.productId} className="flex items-center justify-between gap-3 p-3">
                      <span className="min-w-0">
                        <span className="text-muted-foreground mr-2 tabular-nums">
                          {index + 1}.
                        </span>
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
          ) : null}
          {cash ? (
            <TicketCard
              label={copy.cash}
              className={cn(!hasSales && "lg:col-start-2")}
              top={
                <>
                  <p className="text-muted-foreground text-sm">{copy.cash}</p>
                  <p className="font-heading text-heading mt-1 flex items-center gap-2 text-2xl font-bold">
                    <span
                      aria-hidden="true"
                      className={cn(
                        "size-2.5 rounded-full",
                        cash.open ? "bg-success" : "bg-muted-foreground/50",
                      )}
                    />
                    {cash.open ? copy.cashOpen : copy.cashClosed}
                  </p>
                </>
              }
              bottom={
                cash.open && cash.expectedCents !== null ? (
                  <>
                    <p className="text-muted-foreground text-sm">{copy.cashExpected}</p>
                    <p className="font-heading mt-1 text-2xl font-bold tabular-nums">
                      {formatMoney(cash.expectedCents)}
                    </p>
                  </>
                ) : (
                  <p className="text-muted-foreground text-sm">{copy.cashClosedHint}</p>
                )
              }
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
