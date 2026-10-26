"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { FormField } from "@/components/shared/form-field";
import { NativeSelect } from "@/components/shared/native-select";
import { Button } from "@/components/ui/button";
import { messages } from "@/config/messages.es";
import { openCountAction } from "@/modules/inventory/count-actions";

const copy = messages.counts.form;

export function NewCountForm({ categories }: { categories: { value: string; label: string }[] }) {
  const router = useRouter();
  const [scope, setScope] = useState<"ALL" | "CATEGORY">("ALL");
  const [categoryId, setCategoryId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function open() {
    setError(null);
    startTransition(async () => {
      const result = await openCountAction({
        scope,
        categoryId: scope === "CATEGORY" ? categoryId : undefined,
      });
      if ("id" in result) {
        router.push(`/inventario/conteos/${result.id}`);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <section aria-labelledby="new-count-title" className="bg-card space-y-4 rounded-lg border p-4">
      <h2 id="new-count-title" className="text-lg font-medium">
        {copy.title}
      </h2>
      <fieldset className="flex flex-wrap gap-x-6 gap-y-2">
        <legend className="mb-1 text-sm font-medium">{copy.scope}</legend>
        {(
          [
            ["ALL", copy.scopeAll],
            ["CATEGORY", copy.scopeCategory],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="count-scope"
              value={value}
              checked={scope === value}
              onChange={() => setScope(value)}
              className="accent-primary size-4"
            />
            {label}
          </label>
        ))}
      </fieldset>
      {scope === "CATEGORY" ? (
        <div className="max-w-sm">
          <FormField label={copy.category} htmlFor="count-category">
            <NativeSelect
              id="count-category"
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
            >
              <option value="">{copy.chooseCategory}</option>
              {categories.map((category) => (
                <option key={category.value} value={category.value}>
                  {category.label}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        </div>
      ) : null}
      <p className="text-muted-foreground text-sm">{copy.hint}</p>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <Button type="button" disabled={pending} onClick={open}>
        {pending ? copy.submitting : copy.submit}
      </Button>
    </section>
  );
}
