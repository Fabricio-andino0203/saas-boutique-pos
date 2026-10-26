import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { messages } from "@/config/messages.es";
import { requirePageCapability } from "@/lib/auth";
import { formatLocalDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { hasCapability } from "@/lib/permissions";
import { CountActions } from "@/modules/inventory/components/count-actions";
import { CountItemsTable } from "@/modules/inventory/components/count-items-table";
import { CountScanner } from "@/modules/inventory/components/count-scanner";
import { CountStatusBadge } from "@/modules/inventory/components/count-status-badge";
import { getCountSummary, listCountItems } from "@/modules/inventory/count-queries";

const first = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? "";

export default async function CountPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; dif?: string; pagina?: string }>;
}) {
  const { user } = await requirePageCapability("stock.adjust");
  const { id } = await params;
  const raw = await searchParams;
  const showCost = hasCapability(user.role, "product.viewCost");
  const summary = await getCountSummary(id, { includeCost: showCost });
  if (!summary) {
    notFound();
  }
  const copy = messages.counts;
  const open = summary.status === "OPEN";
  const q = first(raw.q).trim();
  // Mientras se cuenta se ve todo; en revisión y después, solo lo que difiere (se puede cambiar).
  const differencesOnly = first(raw.dif) === "" ? !open : first(raw.dif) === "1";
  const page = Math.max(1, Number.parseInt(first(raw.pagina), 10) || 1);
  const items = await listCountItems(id, { q, differencesOnly, page, includeCost: showCost });
  const lastPage = Math.max(1, Math.ceil(items.total / items.pageSize));

  const href = (target: number) => {
    const query = new URLSearchParams();
    if (q) query.set("q", q);
    query.set("dif", differencesOnly ? "1" : "0");
    if (target > 1) query.set("pagina", String(target));
    return `/inventario/conteos/${id}?${query.toString()}`;
  };

  const cards = [
    { label: copy.columns.items, value: String(summary.items) },
    { label: copy.columns.counted, value: `${summary.counted} / ${summary.items}` },
    { label: copy.review.summary, value: String(summary.differences) },
    ...(summary.valueCents === null
      ? []
      : [{ label: copy.review.valueLabel, value: formatMoney(summary.valueCents) }]),
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Link href="/inventario/conteos" className="text-muted-foreground text-sm hover:underline">
        {copy.back}
      </Link>
      <PageHeader
        title={`${copy.title}: ${
          summary.scope === "CATEGORY" ? summary.scopeName : copy.scope.ALL
        }`}
        description={`${summary.startedByName} · ${formatLocalDateTime(summary.createdAt)}`}
        actions={<CountStatusBadge status={summary.status} />}
      />

      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="bg-card rounded-lg border p-4">
            <dt className="text-muted-foreground text-sm">{card.label}</dt>
            <dd className="text-xl font-semibold tabular-nums">{card.value}</dd>
          </div>
        ))}
      </dl>

      {summary.status === "APPLIED" ? (
        <p role="status" className="bg-muted rounded-lg p-3 text-sm">
          {copy.applied.title}. {copy.applied.by}: {summary.approvedByName}. {copy.applied.at}:{" "}
          {summary.appliedAt ? formatLocalDateTime(summary.appliedAt) : ""}.
        </p>
      ) : null}
      {summary.status === "IN_REVIEW" ? (
        <div className="space-y-1 text-sm">
          <p className="font-medium">{copy.review.title}</p>
          <p className="text-muted-foreground">{copy.review.untouchedWarning}</p>
          {items.rows.some((row) => row.currentQty !== row.expectedQty) ? (
            <p className="text-warning">{copy.review.changedWarning}</p>
          ) : null}
          <p className="text-muted-foreground tabular-nums">
            {summary.netUnits > 0 ? `+${summary.netUnits}` : summary.netUnits} {copy.review.units}
          </p>
        </div>
      ) : null}

      <CountActions
        countId={summary.id}
        status={summary.status}
        canApprove={hasCapability(user.role, "stock.approveCount")}
      />

      {open ? (
        <CountScanner countId={summary.id} items={summary.items} counted={summary.counted} />
      ) : null}

      <section aria-labelledby="count-items" className="space-y-3">
        <h2 id="count-items" className="text-lg font-medium">
          {copy.items.title}
        </h2>
        <form method="get" role="search" className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1 space-y-1.5">
            <label htmlFor="count-q" className="text-sm font-medium">
              {copy.items.search}
            </label>
            <Input id="count-q" name="q" type="search" autoComplete="off" defaultValue={q} />
          </div>
          <label className="flex items-center gap-2 py-2 text-sm">
            <input
              type="checkbox"
              name="dif"
              value="1"
              defaultChecked={differencesOnly}
              className="accent-primary size-4"
            />
            {copy.items.onlyDifferences}
          </label>
          <Button type="submit" variant="outline">
            {messages.inventory.filters.search.submit}
          </Button>
        </form>
        <CountItemsTable
          rows={items.rows}
          editable={open}
          showCost={showCost}
          showCurrent={!open}
        />
        <nav
          aria-label={copy.items.title}
          className="flex items-center justify-between gap-4 text-sm"
        >
          <span className="text-muted-foreground">{items.total}</span>
          <div className="flex gap-4">
            {items.page > 1 ? (
              <Link href={href(items.page - 1)} className="underline underline-offset-4">
                {copy.items.previous}
              </Link>
            ) : null}
            {items.page < lastPage ? (
              <Link href={href(items.page + 1)} className="underline underline-offset-4">
                {copy.items.next}
              </Link>
            ) : null}
          </div>
        </nav>
      </section>
    </div>
  );
}
