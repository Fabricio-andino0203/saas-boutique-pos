import { Camera } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { messages } from "@/config/messages.es";
import { requirePageCapability } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { BulkPhotoUpload } from "@/modules/photos/components/bulk-photo-upload";
import { ProductPhotoCard } from "@/modules/photos/components/product-photo-card";
import { listProductsForPhotos } from "@/modules/photos/queries";

const copy = messages.photos.bulk;

type SearchParams = { q?: string; ver?: string; pagina?: string };

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function ProductPhotosPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requirePageCapability("product.write");
  const raw = await searchParams;
  const q = first(raw.q).trim();
  const showAll = first(raw.ver) === "todos";
  const page = Math.max(1, Number.parseInt(first(raw.pagina), 10) || 1);

  const list = await listProductsForPhotos({ q: q || undefined, missingOnly: !showAll, page });
  const lastPage = Math.max(1, Math.ceil(list.total / list.pageSize));

  const href = (change: { ver?: "todos" | null; pagina?: number }) => {
    const query = new URLSearchParams();
    if (q) query.set("q", q);
    const ver = change.ver === undefined ? (showAll ? "todos" : null) : change.ver;
    if (ver) query.set("ver", ver);
    if (change.pagina && change.pagina > 1) query.set("pagina", String(change.pagina));
    const text = query.toString();
    return text ? `/productos/fotos?${text}` : "/productos/fotos";
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={copy.title}
        description={copy.description}
        actions={
          <Link href="/productos" className={buttonVariants({ variant: "outline" })}>
            {messages.products.back}
          </Link>
        }
      />

      {list.active > 0 ? (
        <p className="text-sm tabular-nums" data-testid="photo-progress">
          <strong>{list.withPhotos}</strong> {copy.progressOf} <strong>{list.active}</strong>{" "}
          {copy.progressSuffix}
        </p>
      ) : null}

      <BulkPhotoUpload />

      {list.active === 0 ? (
        <EmptyState
          icon={Camera}
          title={copy.empty.title}
          action={
            <Link href="/productos/nuevo" className={buttonVariants()}>
              {copy.empty.action}
            </Link>
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-4">
            <nav aria-label={copy.title} className="flex gap-1">
              {(
                [
                  { key: "missing", label: copy.filters.missing, target: null, active: !showAll },
                  { key: "all", label: copy.filters.all, target: "todos", active: showAll },
                ] as const
              ).map((filter) => (
                <Link
                  key={filter.key}
                  href={href({ ver: filter.target })}
                  aria-current={filter.active ? "page" : undefined}
                  className={cn(
                    "rounded-full border px-3 py-1 text-sm",
                    filter.active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  {filter.label}
                </Link>
              ))}
            </nav>
            <form method="get" role="search" className="flex min-w-56 flex-1 items-end gap-2">
              {showAll ? <input type="hidden" name="ver" value="todos" /> : null}
              <div className="flex-1 space-y-1.5">
                <label htmlFor="photo-q" className="text-sm font-medium">
                  {copy.search.label}
                </label>
                <Input
                  id="photo-q"
                  name="q"
                  type="search"
                  autoComplete="off"
                  placeholder={copy.search.placeholder}
                  defaultValue={q}
                />
              </div>
              <Button type="submit">{copy.search.submit}</Button>
              {q ? (
                <Link
                  href={showAll ? "/productos/fotos?ver=todos" : "/productos/fotos"}
                  className="text-muted-foreground py-1.5 text-sm underline"
                >
                  {copy.search.clear}
                </Link>
              ) : null}
            </form>
          </div>

          {list.rows.length === 0 ? (
            q ? (
              <p className="text-muted-foreground text-sm">{copy.noResults}</p>
            ) : (
              <EmptyState
                icon={Camera}
                title={copy.allDone.title}
                action={
                  <Link
                    href={href({ ver: "todos" })}
                    className={buttonVariants({ variant: "outline" })}
                  >
                    {copy.allDone.action}
                  </Link>
                }
              />
            )
          ) : (
            <ul
              className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6"
              data-testid="photo-grid"
            >
              {list.rows.map((product) => (
                <ProductPhotoCard key={product.id} product={product} />
              ))}
            </ul>
          )}

          <nav aria-label={copy.title} className="flex items-center justify-between gap-4 text-sm">
            <span className="text-muted-foreground">
              {list.total} {copy.results}
            </span>
            <div className="flex gap-4">
              {list.page > 1 ? (
                <Link
                  href={href({ pagina: list.page - 1 })}
                  className="underline underline-offset-4"
                >
                  {copy.pagination.previous}
                </Link>
              ) : null}
              {list.page < lastPage ? (
                <Link
                  href={href({ pagina: list.page + 1 })}
                  className="underline underline-offset-4"
                >
                  {copy.pagination.next}
                </Link>
              ) : null}
            </div>
          </nav>
        </>
      )}
    </div>
  );
}
