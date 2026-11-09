"use client";

import { useState, useTransition } from "react";

import { Notice } from "@/components/shared/notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { messages } from "@/config/messages.es";
import { getProductLabelRowsAction, searchLabelProductsAction } from "@/modules/labels/actions";
import type { LabelProductOption } from "@/modules/labels/service";
import type { BuilderRow } from "@/modules/labels/components/label-builder";
import { ProductThumb } from "@/modules/photos/components/product-thumb";

const copy = messages.labels.builder.productPicker;

type Mode = "one" | "stock";

type ProductLabelPickerProps = {
  /** Agrega las prendas a la lista y devuelve cuántas eran nuevas (las que ya estaban no se tocan). */
  onAdd: (rows: BuilderRow[]) => number;
};

/**
 * Para sacar las etiquetas de **un producto** con todas sus tallas y colores. La cantidad es opcional: una de cada prenda o
 * las que hay en stock, como el almacén lo necesite; después se puede cambiar en la lista.
 */
export function ProductLabelPicker({ onAdd }: ProductLabelPickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LabelProductOption[] | null>(null);
  const [mode, setMode] = useState<Mode>("one");
  const [notice, setNotice] = useState<{ tone: "success" | "info" | "error"; text: string } | null>(
    null,
  );
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState<string | null>(null);

  function runSearch() {
    const term = query.trim();
    if (term === "") {
      setResults(null);
      return;
    }
    setNotice(null);
    startTransition(async () => {
      try {
        setResults(await searchLabelProductsAction(term));
      } catch {
        setNotice({ tone: "error", text: copy.failed });
      }
    });
  }

  function add(product: LabelProductOption) {
    setNotice(null);
    setAdding(product.id);
    startTransition(async () => {
      try {
        const rows = await getProductLabelRowsAction(product.id, mode);
        const added = onAdd(rows);
        setNotice(
          added > 0
            ? { tone: "success", text: `${copy.added} ${product.name}.` }
            : { tone: "info", text: copy.alreadyThere },
        );
      } catch {
        setNotice({ tone: "error", text: copy.failed });
      } finally {
        setAdding(null);
      }
    });
  }

  return (
    <section
      aria-labelledby="product-picker-title"
      className="bg-card space-y-3 rounded-lg border p-4"
    >
      <div className="space-y-1">
        <h3 id="product-picker-title" className="font-medium">
          {copy.title}
        </h3>
        <p className="text-muted-foreground text-sm">{copy.hint}</p>
      </div>

      <form
        className="flex max-w-xl flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          runSearch();
        }}
      >
        <label className="min-w-0 flex-1 space-y-1 text-sm font-medium">
          {copy.label}
          <Input
            autoComplete="off"
            placeholder={copy.placeholder}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              if (event.target.value.trim() === "") {
                setResults(null);
              }
            }}
          />
        </label>
        <Button type="submit" variant="outline" loading={pending && adding === null}>
          {pending && adding === null ? copy.searching : copy.search}
        </Button>
      </form>

      <fieldset className="flex flex-wrap gap-x-6 gap-y-2">
        <legend className="mb-1 text-sm font-medium">{copy.quantity}</legend>
        {(["one", "stock"] as const).map((option) => (
          <label key={option} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="label-quantity-mode"
              value={option}
              checked={mode === option}
              onChange={() => setMode(option)}
              className="accent-primary size-4"
            />
            {option === "one" ? copy.modeOne : copy.modeStock}
          </label>
        ))}
      </fieldset>

      {results !== null ? (
        results.length === 0 ? (
          <p className="text-muted-foreground text-sm">{copy.none}</p>
        ) : (
          <ul className="divide-divider divide-y rounded-lg border">
            {results.map((product) => (
              <li key={product.id} className="flex flex-wrap items-center gap-3 p-2.5">
                <ProductThumb imageId={product.imageId} className="size-10 rounded-md" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{product.name}</p>
                  <p className="text-muted-foreground text-sm tabular-nums">
                    {product.code} · {product.variantCount} {copy.variants} · {product.onHand}{" "}
                    {copy.units}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  loading={adding === product.id}
                  aria-label={`${copy.add}: ${product.name}`}
                  onClick={() => add(product)}
                >
                  {adding === product.id ? copy.adding : copy.add}
                </Button>
              </li>
            ))}
          </ul>
        )
      ) : null}
      {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}
    </section>
  );
}
