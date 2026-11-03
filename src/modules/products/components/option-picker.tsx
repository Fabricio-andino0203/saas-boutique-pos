"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/shared/notice";
import { messages } from "@/config/messages.es";
import { cn } from "@/lib/utils";

const copy = messages.products.wizard;

export type PickerItem = { id: string; name: string; hex?: string | null };

type OptionPickerProps = {
  legend: string;
  items: PickerItem[];
  selected: string[];
  onToggle: (id: string) => void;
  /** Crea la opción nueva; devuelve un mensaje de error o `null` si salió bien. */
  onAdd: (name: string) => Promise<string | null>;
  addLabel: string;
  placeholder: string;
};

/** Chips que se marcan y se desmarcan, con "agregar nueva" en la misma pantalla. */
export function OptionPicker({
  legend,
  items,
  selected,
  onToggle,
  onAdd,
  addLabel,
  placeholder,
}: OptionPickerProps) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  async function add() {
    const name = draft.trim();
    if (!name || adding) {
      return;
    }
    setAdding(true);
    setError(await onAdd(name));
    setAdding(false);
    setDraft((current) => (current.trim() === name ? "" : current));
  }

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => {
          const active = selected.includes(item.id);
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={active}
              onClick={() => onToggle(item.id)}
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition-colors",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input bg-background hover:bg-muted",
              )}
            >
              {item.hex ? (
                <span
                  aria-hidden="true"
                  className="size-3 rounded-full border border-black/20"
                  style={{ backgroundColor: item.hex }}
                />
              ) : null}
              {item.name}
            </button>
          );
        })}
      </div>
      <div className="flex max-w-sm gap-2">
        <Input
          aria-label={addLabel}
          placeholder={placeholder}
          autoComplete="off"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void add();
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={adding || draft.trim() === ""}
          onClick={add}
        >
          {copy.add}
        </Button>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
    </fieldset>
  );
}
