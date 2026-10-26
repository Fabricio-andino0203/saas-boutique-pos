import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { NativeSelect } from "@/components/shared/native-select";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { messages } from "@/config/messages.es";
import { requirePageCapability } from "@/lib/auth";
import { hasCapability } from "@/lib/permissions";
import { ProductsTable } from "@/modules/products/components/products-table";
import { getFormOptions, listProducts } from "@/modules/products/service";
import type { ProductListParams } from "@/modules/products/types";

type SearchParams = {
  q?: string;
  categoria?: string;
  marca?: string;
  estado?: string;
  pagina?: string;
};

const STATUSES = ["active", "archived", "all"] as const;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { user } = await requirePageCapability("product.write");
  const raw = await searchParams;
  const q = first(raw.q).trim();
  const categoryId = first(raw.categoria);
  const brandId = first(raw.marca);
  const status = STATUSES.find((value) => value === first(raw.estado)) ?? "active";
  const page = Math.max(1, Number.parseInt(first(raw.pagina), 10) || 1);

  const params: ProductListParams = {
    q: q || undefined,
    categoryId: categoryId || undefined,
    brandId: brandId || undefined,
    status,
    page,
  };
  const [list, options] = await Promise.all([listProducts(params), getFormOptions()]);
  const copy = messages.products;
  const hasFilters = Boolean(q || categoryId || brandId || status !== "active");
  const lastPage = Math.max(1, Math.ceil(list.total / list.pageSize));

  const pageHref = (target: number) => {
    const query = new URLSearchParams();
    if (q) query.set("q", q);
    if (categoryId) query.set("categoria", categoryId);
    if (brandId) query.set("marca", brandId);
    if (status !== "active") query.set("estado", status);
    if (target > 1) query.set("pagina", String(target));
    const text = query.toString();
    return text ? `/productos?${text}` : "/productos";
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={copy.title}
        description={copy.description}
        actions={
          <Link href="/productos/nuevo" className={buttonVariants()}>
            {copy.new}
          </Link>
        }
      />

      <form method="get" role="search" className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1 space-y-1.5">
          <label htmlFor="filter-q" className="text-sm font-medium">
            {copy.search.label}
          </label>
          <Input
            id="filter-q"
            name="q"
            type="search"
            autoComplete="off"
            placeholder={copy.search.placeholder}
            defaultValue={q}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="filter-category" className="text-sm font-medium">
            {copy.filters.category}
          </label>
          <NativeSelect id="filter-category" name="categoria" defaultValue={categoryId}>
            <option value="">{copy.filters.allCategories}</option>
            {options.categories.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="filter-brand" className="text-sm font-medium">
            {copy.filters.brand}
          </label>
          <NativeSelect id="filter-brand" name="marca" defaultValue={brandId}>
            <option value="">{copy.filters.allBrands}</option>
            {options.brands.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="filter-status" className="text-sm font-medium">
            {copy.filters.status}
          </label>
          <NativeSelect id="filter-status" name="estado" defaultValue={status}>
            <option value="active">{copy.filters.active}</option>
            <option value="archived">{copy.filters.archived}</option>
            <option value="all">{copy.filters.all}</option>
          </NativeSelect>
        </div>
        <Button type="submit">{copy.search.submit}</Button>
        {hasFilters ? (
          <Link href="/productos" className="text-muted-foreground py-1.5 text-sm underline">
            {copy.search.clear}
          </Link>
        ) : null}
      </form>

      <ProductsTable
        rows={list.rows}
        categories={options.categories}
        seasons={options.seasons}
        canViewCost={hasCapability(user.role, "product.viewCost")}
        canChangePrice={hasCapability(user.role, "price.change")}
        hasFilters={hasFilters}
      />

      <nav aria-label={copy.title} className="flex items-center justify-between gap-4 text-sm">
        <span className="text-muted-foreground">
          {list.total} {copy.results}
        </span>
        <div className="flex gap-4">
          {list.page > 1 ? (
            <Link href={pageHref(list.page - 1)} className="underline underline-offset-4">
              {copy.pagination.previous}
            </Link>
          ) : null}
          {list.page < lastPage ? (
            <Link href={pageHref(list.page + 1)} className="underline underline-offset-4">
              {copy.pagination.next}
            </Link>
          ) : null}
        </div>
      </nav>
    </div>
  );
}
