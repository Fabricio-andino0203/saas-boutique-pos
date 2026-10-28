import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { messages } from "@/config/messages.es";
import { requirePageCapability } from "@/lib/auth";
import { formatMoney, formatPercentBps } from "@/lib/format";
import { cn } from "@/lib/utils";
import { reportAccess } from "@/modules/reports/access";
import {
  CashierBreakdown,
  DimensionBreakdown,
  HourBreakdown,
  MethodBreakdown,
  PeriodBreakdown,
} from "@/modules/reports/components/sales-breakdown";
import { RangeFilter } from "@/modules/reports/components/range-filter";
import { StatCard } from "@/modules/reports/components/stat-card";
import {
  getSalesByCashier,
  getSalesByDimension,
  getSalesByHour,
  getSalesByMethod,
  getSalesByPeriod,
  getSalesSummary,
} from "@/modules/reports/queries";
import { daysInRange, parseRange } from "@/modules/reports/ranges";

const copy = messages.reports;

const VIEWS = ["periodo", "hora", "cajero", "categoria", "marca", "metodo"] as const;
type View = (typeof VIEWS)[number];
const VIEW_LABEL: Record<View, string> = {
  periodo: copy.sales.by.period,
  hora: copy.sales.by.hour,
  cajero: copy.sales.by.cashier,
  categoria: copy.sales.by.category,
  marca: copy.sales.by.brand,
  metodo: copy.sales.by.method,
};

const first = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? "";

export default async function SalesReportPage({
  searchParams,
}: {
  searchParams: Promise<{ rango?: string; desde?: string; hasta?: string; por?: string }>;
}) {
  const { user } = await requirePageCapability("report.view");
  const access = reportAccess(user);
  const raw = await searchParams;
  const range = parseRange({
    rango: first(raw.rango),
    desde: first(raw.desde),
    hasta: first(raw.hasta),
  });
  const view: View = (VIEWS as readonly string[]).includes(first(raw.por))
    ? (first(raw.por) as View)
    : "periodo";

  const summary = await getSalesSummary(range, access.scope, access.withCosts);
  const granularity = daysInRange(range) > 62 ? "month" : "day";
  const keep = (por: View) => {
    const params = new URLSearchParams({ por });
    if (range.preset) {
      params.set("rango", range.preset);
    } else {
      params.set("desde", range.fromKey);
      params.set("hasta", range.toKey);
    }
    return `/reportes/ventas?${params.toString()}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader title={copy.sales.title} description={copy.description} />
      {access.seesEveryone ? null : (
        <p role="status" className="bg-muted rounded-lg border px-4 py-2 text-sm">
          {copy.onlyMine}
        </p>
      )}

      <RangeFilter path="/reportes/ventas" range={range} params={{ por: view }} />
      <p className="text-muted-foreground text-sm">
        {copy.filter.showing} {range.fromKey} {copy.filter.until} {range.toKey}
      </p>

      <section aria-label={copy.sales.title} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={copy.summary.sales} value={formatMoney(summary.salesCents)} />
        <StatCard label={copy.summary.returns} value={formatMoney(summary.returnsCents)} />
        <StatCard label={copy.summary.net} value={formatMoney(summary.netCents)} />
        <StatCard label={copy.summary.tickets} value={String(summary.tickets)} />
        <StatCard label={copy.summary.average} value={formatMoney(summary.averageTicketCents)} />
        <StatCard label={copy.summary.units} value={String(summary.unitsSold)} />
        {summary.financial ? (
          <>
            <StatCard
              label={copy.summary.profit}
              value={formatMoney(summary.financial.profitCents)}
              hint={`${copy.summary.revenue}: ${formatMoney(summary.financial.revenueCents)} · ${copy.summary.cost}: ${formatMoney(summary.financial.costCents)}`}
              tone={summary.financial.profitCents >= 0 ? "good" : "bad"}
            />
            <StatCard
              label={copy.summary.margin}
              value={`${formatPercentBps(summary.financial.marginBps)} %`}
            />
          </>
        ) : null}
      </section>

      <nav aria-label={copy.sales.title} className="flex flex-wrap gap-2">
        {VIEWS.map((option) => (
          <Link
            key={option}
            href={keep(option)}
            aria-current={view === option ? "page" : undefined}
            className={cn(
              "focus-visible:ring-ring/50 min-h-9 rounded-lg border px-3.5 py-1.5 text-sm outline-none focus-visible:ring-3",
              view === option
                ? "border-primary bg-primary text-primary-foreground"
                : "hover:bg-muted",
            )}
          >
            {VIEW_LABEL[option]}
          </Link>
        ))}
      </nav>

      <section aria-labelledby="breakdown-title" className="space-y-3">
        <h2 id="breakdown-title" className="text-lg font-medium">
          {VIEW_LABEL[view]}
        </h2>
        {view === "periodo" ? (
          <PeriodBreakdown
            rows={await getSalesByPeriod(range, granularity, access.scope)}
            granularity={granularity}
          />
        ) : view === "hora" ? (
          <HourBreakdown rows={await getSalesByHour(range, access.scope)} />
        ) : view === "cajero" ? (
          <CashierBreakdown rows={await getSalesByCashier(range, access.scope)} />
        ) : view === "metodo" ? (
          <MethodBreakdownLoader range={range} scope={access.scope} />
        ) : (
          <DimensionBreakdown
            dimension={view === "categoria" ? "category" : "brand"}
            rows={await getSalesByDimension(
              range,
              view === "categoria" ? "category" : "brand",
              access.scope,
              access.withCosts,
            )}
          />
        )}
      </section>
    </div>
  );
}

async function MethodBreakdownLoader({
  range,
  scope,
}: {
  range: ReturnType<typeof parseRange>;
  scope: { onlySellerId?: string };
}) {
  const result = await getSalesByMethod(range, scope);
  return <MethodBreakdown methods={result.methods} refunds={result.refunds} />;
}
