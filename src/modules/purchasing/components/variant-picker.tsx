"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/shared/notice";
import { messages } from "@/config/messages.es";
import { ProductThumb } from "@/modules/photos/components/product-thumb";
import type { VariantOption, VariantPage } from "@/modules/purchasing/queries";

const copy = messages.purchasing.picker;

type VariantPickerProps = {
  onPick: (variant: VariantOption) => void;
  /** Sirve para avisar, por ejemplo, que la prenda no está en la orden. */
  helper?: string | null;
  /** La búsqueda de esta pantalla: cada módulo trae la suya, con su propio permiso (no la de otro módulo). */
  search: (query: string) => Promise<VariantOption[]>;
  /**
   * Opcional. Si se da, mientras no se escribe nada la lista muestra TODAS las prendas (de a páginas, con «Ver más»), para elegir
   * mirando en vez de adivinar qué buscar; al escribir se filtra. `initial` es la primera página (la trae la página del servidor,
   * así la lista ya está al abrir la pantalla) y `load` pide las siguientes.
   */
  browse?: { initial: VariantPage; load: (offset: number) => Promise<VariantPage> };
};

/**
 * Escáner y buscador: un código de barras o un código exacto entra de inmediato (como al escanear);
 * un nombre muestra las coincidencias para elegir. Con `browse`, además, se ve todo el catálogo.
 */
export function VariantPicker({ onPick, helper, search, browse }: VariantPickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<VariantOption[] | null>(null);
  const [all, setAll] = useState<VariantOption[]>(browse?.initial.items ?? []);
  const [hasMore, setHasMore] = useState(browse?.initial.hasMore ?? false);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  function loadMore() {
    if (!browse) {
      return;
    }
    startTransition(async () => {
      try {
        const page = await browse.load(all.length);
        setAll((current) => [...current, ...page.items]);
        setHasMore(page.hasMore);
        setFailed(false);
      } catch {
        setFailed(true);
      }
    });
  }

  function pick(option: VariantOption) {
    onPick(option);
    setQuery("");
    setResults(null);
  }

  function runSearch() {
    const term = query.trim();
    if (term === "") {
      return;
    }
    startTransition(async () => {
      try {
        const found = await search(term);
        setFailed(false);
        if (found.length === 1 && found[0]?.exact) {
          pick(found[0]);
        } else {
          setResults(found);
        }
      } catch {
        setFailed(true);
      }
    });
  }

  const showingAll = results === null && browse !== undefined;
  const shown = results ?? (showingAll ? all : null);

  return (
    <div className="space-y-2">
      <label htmlFor="variant-picker" className="text-sm font-medium">
        {copy.label}
      </label>
      <div className="flex max-w-xl gap-2">
        <Input
          id="variant-picker"
          autoComplete="off"
          placeholder={copy.placeholder}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            if (event.target.value.trim() === "") {
              setResults(null); // sin texto vuelve la lista completa
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              runSearch();
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={pending || query.trim() === ""}
          onClick={runSearch}
        >
          {copy.search}
        </Button>
      </div>
      {helper ? <Notice tone="error">{helper}</Notice> : null}
      {failed ? <Notice tone="error">{copy.failed}</Notice> : null}
      {showingAll ? (
        <p className="text-muted-foreground text-sm">
          <span className="text-foreground font-medium">{copy.all}</span> · {copy.allHint}
        </p>
      ) : null}
      {shown ? (
        shown.length === 0 ? (
          <p className="text-muted-foreground text-sm">{showingAll ? copy.emptyAll : copy.none}</p>
        ) : (
          <ul
            className="max-h-96 max-w-xl divide-y overflow-y-auto rounded-lg border"
            data-testid={showingAll ? "picker-all" : "picker-results"}
          >
            {shown.map((option) => (
              <li key={option.variantId} className="flex items-center justify-between gap-3 p-2">
                <span className="flex items-center gap-3">
                  <ProductThumb imageId={option.imageId} className="h-12 w-10" />
                  <span className="text-sm">
                    <span className="font-medium">{option.productName}</span>
                    {option.label ? ` · ${option.label}` : ""}
                    <span className="text-muted-foreground ml-2 font-mono text-xs">
                      {option.sku}
                    </span>
                  </span>
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-label={`${copy.pick}: ${option.productName} ${option.label}`}
                  onClick={() => pick(option)}
                >
                  {copy.pick}
                </Button>
              </li>
            ))}
          </ul>
        )
      ) : null}
      {showingAll && hasMore ? (
        <Button type="button" variant="ghost" size="sm" loading={pending} onClick={loadMore}>
          {pending ? copy.loading : copy.loadMore}
        </Button>
      ) : null}
    </div>
  );
}
