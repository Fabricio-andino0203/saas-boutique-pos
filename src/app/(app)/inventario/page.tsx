import Link from "next/link";

import { NativeSelect } from "@/components/shared/native-select";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { messages } from "@/config/messages.es";
import { requirePageCapability } from "@/lib/auth";
import { formatMoney } from "@/lib/format";
import { hasCapability } from "@/lib/permissions";
import { StockTable } from "@/modules/inventory/components/stock-table";
import { listStock } from "@/modules/inventory/queries";
import type { StockFilter } from "@/modules/inventory/types";
import { getFormOptions } from "@/modules/products/service";

type SearchParams = {
  q?: string;
  categoria?: string;
  temporada?: string;
  mostrar?: string;
  pagina?: string;
};

const FILTERS: readonly StockFilter[] = ["all", "low", "out", "in"];

const first = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? "";

export default async function StockPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { user } = await requirePageCapability("stock.adjust");
  const raw = await searchParams;
  const q = first(raw.q).trim();
  const categoryId = first(raw.categoria);
  const seasonId = first(raw.temporada);
  const filter = FILTERS.find((value) => value === first(raw.mostrar)) ?? "all";
  const page = Math.max(1, Number.parseInt(first(raw.pagina), 10) || 1);
  const showCost = hasCapability(user.role, "product.viewCost");

  const [stock, options] = await Promise.all([
    listStock({
      q: q || undefined,
      categoryId: categoryId || undefined,
      seasonId: seasonId || undefined,
      filter,
      page,
      includeCost: showCost,
    }),
    getFormOptions(),
  ]);
  const copy = messages.inventory;
  const filtered = Boolean(q || categoryId || seasonId || filter !== "all");
  const lastPage = Math.max(1, Math.ceil(stock.total / stock.pageSize));

  const pageHref = (target: number) => {
    const query = new URLSearchParams();
    if (q) query.set("q", q);
    if (categoryId) query.set("categoria", categoryId);
    if (seasonId) query.set("temporada", seasonId);
    if (filter !== "all") query.set("mostrar", filter);
    if (target > 1) query.set("pagina", String(target));
    const text = query.toString();
    return text ? `/inventario?${text}` : "/inventario";
  };

  const cards = [
    { label: copy.summary.products, value: String(stock.totals.products) },
    { label: copy.summary.units, value: String(stock.totals.units) },
    ...(stock.totals.costValueCents === null
      ? []
      : [{ label: copy.summary.costValue, value: formatMoney(stock.totals.costValueCents) }]),
    { label: copy.summary.priceValue, value: formatMoney(stock.totals.priceValueCents) },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={copy.title} description={copy.description} />

      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="bg-card rounded-lg border p-4">
            <dt className="text-muted-foreground text-sm">{card.label}</dt>
            <dd className="text-xl font-semibold tabular-nums">{card.value}</dd>
          </div>
        ))}
      </dl>

      <form method="get" role="search" className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1 space-y-1.5">
          <label htmlFor="stock-q" className="text-sm font-medium">
            {copy.filters.search.label}
          </label>
          <Input
            id="stock-q"
            name="q"
            type="search"
            autoComplete="off"
            placeholder={copy.filters.search.placeholder}
            defaultValue={q}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="stock-category" className="text-sm font-medium">
            {copy.filters.category}
          </label>
          <NativeSelect id="stock-category" name="categoria" defaultValue={categoryId}>
            <option value="">{copy.filters.allCategories}</option>
            {options.categories.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="stock-season" className="text-sm font-medium">
            {copy.filters.season}
          </label>
          <NativeSelect id="stock-season" name="temporada" defaultValue={seasonId}>
            <option value="">{copy.filters.allSeasons}</option>
            {options.seasons.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="stock-filter" className="text-sm font-medium">
            {copy.filters.status}
          </label>
          <NativeSelect id="stock-filter" name="mostrar" defaultValue={filter}>
            <option value="all">{copy.filters.all}</option>
            <option value="low">{copy.filters.low}</option>
            <option value="out">{copy.filters.out}</option>
            <option value="in">{copy.filters.in}</option>
          </NativeSelect>
        </div>
        <Button type="submit">{copy.filters.search.submit}</Button>
        {filtered ? (
          <Link href="/inventario" className="text-muted-foreground py-1.5 text-sm underline">
            {copy.filters.search.clear}
          </Link>
        ) : null}
      </form>

      <StockTable rows={stock.rows} showCost={showCost} filtered={filtered} />

      <nav aria-label={copy.title} className="flex items-center justify-between gap-4 text-sm">
        <span className="text-muted-foreground">
          {stock.total} {copy.results}
        </span>
        <div className="flex gap-4">
          {stock.page > 1 ? (
            <Link href={pageHref(stock.page - 1)} className="underline underline-offset-4">
              {messages.products.pagination.previous}
            </Link>
          ) : null}
          {stock.page < lastPage ? (
            <Link href={pageHref(stock.page + 1)} className="underline underline-offset-4">
              {messages.products.pagination.next}
            </Link>
          ) : null}
        </div>
      </nav>
    </div>
  );
}
