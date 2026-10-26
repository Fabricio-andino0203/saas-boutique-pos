"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { messages } from "@/config/messages.es";
import { searchVariantsAction } from "@/modules/purchasing/actions";
import type { VariantOption } from "@/modules/purchasing/queries";

const copy = messages.purchasing.picker;

type VariantPickerProps = {
  onPick: (variant: VariantOption) => void;
  /** Sirve para avisar, por ejemplo, que la prenda no está en la orden. */
  helper?: string | null;
};

/**
 * Escáner y buscador: un código de barras o un código exacto entra de inmediato (como al escanear);
 * un nombre muestra las coincidencias para elegir.
 */
export function VariantPicker({ onPick, helper }: VariantPickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<VariantOption[] | null>(null);
  const [pending, startTransition] = useTransition();

  function search() {
    const term = query.trim();
    if (term === "") {
      return;
    }
    startTransition(async () => {
      const found = await searchVariantsAction(term);
      if (found.length === 1 && found[0]?.exact) {
        onPick(found[0]);
        setQuery("");
        setResults(null);
      } else {
        setResults(found);
      }
    });
  }

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
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              search();
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={pending || query.trim() === ""}
          onClick={search}
        >
          {copy.search}
        </Button>
      </div>
      {helper ? (
        <p role="alert" className="text-destructive text-sm">
          {helper}
        </p>
      ) : null}
      {results ? (
        results.length === 0 ? (
          <p className="text-muted-foreground text-sm">{copy.none}</p>
        ) : (
          <ul className="max-w-xl divide-y rounded-lg border">
            {results.map((option) => (
              <li key={option.variantId} className="flex items-center justify-between gap-3 p-2">
                <span className="text-sm">
                  <span className="font-medium">{option.productName}</span>
                  {option.label ? ` · ${option.label}` : ""}
                  <span className="text-muted-foreground ml-2 font-mono text-xs">{option.sku}</span>
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-label={`${copy.pick}: ${option.productName} ${option.label}`}
                  onClick={() => {
                    onPick(option);
                    setQuery("");
                    setResults(null);
                  }}
                >
                  {copy.pick}
                </Button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
