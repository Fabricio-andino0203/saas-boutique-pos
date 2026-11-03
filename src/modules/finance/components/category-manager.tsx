"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Notice } from "@/components/shared/notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { messages } from "@/config/messages.es";
import {
  createFinanceCategoryAction,
  renameFinanceCategoryAction,
  setFinanceCategoryArchivedAction,
} from "@/modules/finance/actions";
import type { CategoryRow } from "@/modules/finance/queries";
import type { FinanceType } from "@/modules/finance/schemas";

const copy = messages.finance.categories;

/** Las categorías de gastos y de ingresos: agregar, renombrar, archivar y restaurar. Nada se borra. */
export function CategoryManager({ categories }: { categories: readonly CategoryRow[] }) {
  const [showArchived, setShowArchived] = useState(false);
  const archivedCount = categories.filter((category) => category.archived).length;

  return (
    <div className="space-y-6">
      {archivedCount > 0 ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="accent-primary size-4"
            checked={showArchived}
            onChange={(event) => setShowArchived(event.target.checked)}
          />
          {copy.showArchived} ({archivedCount})
        </label>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-2">
        {(["EXPENSE", "INCOME"] as const).map((type) => (
          <CategoryColumn
            key={type}
            type={type}
            rows={categories.filter(
              (category) => category.type === type && (showArchived || !category.archived),
            )}
          />
        ))}
      </div>
    </div>
  );
}

function CategoryColumn({ type, rows }: { type: FinanceType; rows: readonly CategoryRow[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const headingId = `categories-${type}`;

  function add() {
    setError(null);
    startTransition(async () => {
      const result = await createFinanceCategoryAction({ type, name });
      if (result.ok) {
        setName("");
        toast.success(messages.toasts.financeCategoryCreated);
        router.refresh();
      } else {
        setError(result.error.message);
      }
    });
  }

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <h2 id={headingId} className="text-lg font-medium">
        {type === "EXPENSE" ? copy.expenses : copy.income}
      </h2>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">{copy.empty}</p>
      ) : (
        <ul className="divide-divider bg-card divide-y rounded-lg border">
          {rows.map((row) => (
            <CategoryItem key={row.id} row={row} />
          ))}
        </ul>
      )}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <label className="min-w-0 flex-1 space-y-1 text-sm font-medium">
          {copy.newName}
          <Input
            value={name}
            maxLength={60}
            autoComplete="off"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <Button type="submit" variant="outline" loading={pending}>
          {pending ? copy.adding : copy.add}
        </Button>
      </form>
      {error ? <Notice tone="error">{error}</Notice> : null}
    </section>
  );
}

function CategoryItem({ row }: { row: CategoryRow }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.name);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await renameFinanceCategoryAction(row.id, draft);
      if (result.ok) {
        setEditing(false);
        toast.success(messages.toasts.financeCategoryRenamed);
        router.refresh();
      } else {
        setError(result.error.message);
      }
    });
  }

  function toggleArchived() {
    setError(null);
    startTransition(async () => {
      const result = await setFinanceCategoryArchivedAction(row.id, !row.archived);
      if (result.ok) {
        toast.success(
          row.archived
            ? messages.toasts.financeCategoryRestored
            : messages.toasts.financeCategoryArchived,
        );
        router.refresh();
      } else {
        setError(result.error.message);
      }
    });
  }

  return (
    <li className="space-y-2 p-3">
      {editing ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <Input
            aria-label={copy.rename}
            autoFocus
            value={draft}
            maxLength={60}
            className="min-w-0 flex-1"
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button type="submit" size="sm" loading={pending}>
            {copy.save}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setEditing(false);
              setDraft(row.name);
              setError(null);
            }}
          >
            {messages.common.cancel}
          </Button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <span className={row.archived ? "text-muted-foreground" : "font-medium"}>
              {row.name}
            </span>
            <span className="text-muted-foreground ml-2 text-xs tabular-nums">
              {row.entryCount} {copy.used}
            </span>
            {row.archived ? (
              <span className="bg-muted text-muted-foreground ml-2 rounded-full px-2 py-0.5 text-xs">
                {copy.archived}
              </span>
            ) : null}
          </div>
          <div className="flex gap-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label={`${copy.rename}: ${row.name}`}
              onClick={() => setEditing(true)}
            >
              {copy.rename}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              loading={pending}
              aria-label={`${row.archived ? copy.restore : copy.archive}: ${row.name}`}
              onClick={toggleArchived}
            >
              {row.archived ? copy.restore : copy.archive}
            </Button>
          </div>
        </div>
      )}
      {error ? <Notice tone="error">{error}</Notice> : null}
    </li>
  );
}
