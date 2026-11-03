"use client";

import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { DataTable } from "@/components/shared/data-table";
import { FormField } from "@/components/shared/form-field";
import { MoneyInput } from "@/components/shared/money-input";
import { NativeSelect } from "@/components/shared/native-select";
import { buttonVariants, Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/shared/notice";
import { messages } from "@/config/messages.es";
import { formatMoney, parsePercentBps } from "@/lib/format";
import { ProductThumb } from "@/modules/photos/components/product-thumb";
import { bulkEditProductsAction } from "@/modules/products/actions";
import type { Option, ProductRow } from "@/modules/products/types";

const copy = messages.products;

type PriceMode = "none" | "set" | "percent";

type BulkPanelProps = {
  selected: string[];
  categories: Option[];
  seasons: Option[];
  canChangePrice: boolean;
  onDone: () => void;
  onCancel: () => void;
};

function BulkPanel({
  selected,
  categories,
  seasons,
  canChangePrice,
  onDone,
  onCancel,
}: BulkPanelProps) {
  const router = useRouter();
  const [categoryId, setCategoryId] = useState("");
  const [seasonId, setSeasonId] = useState("");
  const [mode, setMode] = useState<PriceMode>("none");
  const [cents, setCents] = useState<number | null>(null);
  const [percent, setPercent] = useState("");
  const [feedback, setFeedback] = useState<{ error?: string; success?: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function apply() {
    let price: { mode: PriceMode; cents?: number; bps?: number } = { mode: "none" };
    if (mode === "set") {
      price = { mode, cents: cents ?? 0 };
    } else if (mode === "percent") {
      const bps = parsePercentBps(percent);
      if (bps === null) {
        setFeedback({ error: copy.validation.percent });
        return;
      }
      price = { mode, bps };
    }
    setFeedback(null);
    startTransition(async () => {
      const result = await bulkEditProductsAction({
        productIds: selected,
        categoryId,
        seasonId,
        price,
      });
      if (result?.success) {
        router.refresh();
        onDone();
      } else {
        setFeedback(result ?? null);
      }
    });
  }

  return (
    <section aria-labelledby="bulk-title" className="bg-muted/50 space-y-4 rounded-lg border p-4">
      <h2 id="bulk-title" className="font-medium">
        {copy.bulk.title} · {selected.length} {copy.bulk.selected}
      </h2>
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label={copy.bulk.category} htmlFor="bulk-category">
          <NativeSelect
            id="bulk-category"
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
          >
            <option value="">{copy.bulk.keep}</option>
            {categories.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label={copy.bulk.season} htmlFor="bulk-season">
          <NativeSelect
            id="bulk-season"
            value={seasonId}
            onChange={(event) => setSeasonId(event.target.value)}
          >
            <option value="">{copy.bulk.keep}</option>
            {seasons.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        {canChangePrice ? (
          <FormField label={copy.bulk.price} htmlFor="bulk-price-mode">
            <NativeSelect
              id="bulk-price-mode"
              value={mode}
              onChange={(event) => setMode(event.target.value as PriceMode)}
            >
              <option value="none">{copy.bulk.priceNone}</option>
              <option value="set">{copy.bulk.priceSet}</option>
              <option value="percent">{copy.bulk.pricePercent}</option>
            </NativeSelect>
          </FormField>
        ) : null}
      </div>
      {mode === "set" ? (
        <div className="max-w-xs">
          <FormField label={copy.bulk.priceValue} htmlFor="bulk-price-value">
            <MoneyInput id="bulk-price-value" valueCents={cents} onValueChange={setCents} />
          </FormField>
        </div>
      ) : null}
      {mode === "percent" ? (
        <div className="max-w-xs">
          <FormField
            label={copy.bulk.percentValue}
            htmlFor="bulk-percent-value"
            hint={copy.bulk.percentHint}
          >
            <Input
              id="bulk-percent-value"
              inputMode="decimal"
              autoComplete="off"
              value={percent}
              onChange={(event) => setPercent(event.target.value)}
            />
          </FormField>
        </div>
      ) : null}
      {feedback?.error ? <Notice tone="error">{feedback.error}</Notice> : null}
      {feedback?.success ? <Notice tone="success">{feedback.success}</Notice> : null}
      <div className="flex gap-2">
        <Button type="button" loading={pending} onClick={apply}>
          {pending ? copy.bulk.applying : copy.bulk.apply}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          {copy.bulk.cancel}
        </Button>
      </div>
    </section>
  );
}

type ProductsTableProps = {
  rows: ProductRow[];
  categories: Option[];
  seasons: Option[];
  canViewCost: boolean;
  canChangePrice: boolean;
  hasFilters: boolean;
};

export function ProductsTable({
  rows,
  categories,
  seasons,
  canViewCost,
  canChangePrice,
  hasFilters,
}: ProductsTableProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const columns = useMemo<ColumnDef<ProductRow>[]>(() => {
    const toggle = (id: string) => {
      setNotice(null);
      setSelected((current) =>
        current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
      );
    };
    const selectable = rows.filter((row) => !row.archived).map((row) => row.id);
    const allSelected = selectable.length > 0 && selectable.every((id) => selected.includes(id));

    const base: ColumnDef<ProductRow>[] = [
      {
        id: "select",
        header: () => (
          <input
            type="checkbox"
            aria-label={copy.columns.select}
            className="accent-primary size-4"
            checked={allSelected}
            onChange={() => setSelected(allSelected ? [] : selectable)}
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            aria-label={`${copy.selectRow} ${row.original.name}`}
            className="accent-primary size-4"
            disabled={row.original.archived}
            checked={selected.includes(row.original.id)}
            onChange={() => toggle(row.original.id)}
          />
        ),
      },
      {
        id: "name",
        header: copy.columns.name,
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <ProductThumb imageId={row.original.coverImageId} className="h-12 w-10" />
            <div className="space-y-0.5">
              <Link
                href={`/productos/${row.original.id}`}
                className="text-primary font-medium underline underline-offset-4"
              >
                {row.original.name}
              </Link>
              <div className="text-muted-foreground font-mono text-xs">{row.original.code}</div>
            </div>
          </div>
        ),
      },
      {
        id: "category",
        header: copy.columns.category,
        cell: ({ row }) => row.original.categoryName,
      },
      { id: "brand", header: copy.columns.brand, cell: ({ row }) => row.original.brandName },
      {
        id: "price",
        header: copy.columns.price,
        cell: ({ row }) => (
          <span className="tabular-nums">{formatMoney(row.original.basePriceCents)}</span>
        ),
      },
    ];
    if (canViewCost) {
      base.push({
        id: "cost",
        header: copy.columns.cost,
        cell: ({ row }) => (
          <span className="tabular-nums">{formatMoney(row.original.baseCostCents)}</span>
        ),
      });
    }
    base.push(
      {
        id: "variants",
        header: copy.columns.variants,
        cell: ({ row }) => <span className="tabular-nums">{row.original.variantCount}</span>,
      },
      {
        id: "stock",
        header: copy.columns.stock,
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-2 tabular-nums">
            {row.original.onHand}
            {row.original.lowStock ? (
              <span className="bg-destructive/10 text-destructive rounded px-1.5 py-0.5 text-xs">
                {copy.lowStock}
              </span>
            ) : null}
          </span>
        ),
      },
      {
        id: "status",
        header: copy.columns.status,
        cell: ({ row }) => (row.original.archived ? copy.status.archived : copy.status.active),
      },
    );
    return base;
  }, [rows, selected, canViewCost]);

  return (
    <div className="space-y-4">
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {selected.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm">
            {selected.length} {copy.bulk.selected}
          </span>
          <Button type="button" variant="outline" onClick={() => setBulkOpen(true)}>
            {copy.bulk.open}
          </Button>
          <Link
            href={`/inventario/etiquetas?productos=${selected.join(",")}`}
            className={buttonVariants({ variant: "outline" })}
          >
            {messages.labels.fromSelection}
          </Link>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setSelected([]);
              setBulkOpen(false);
            }}
          >
            {copy.bulk.clear}
          </Button>
        </div>
      ) : null}
      {bulkOpen && selected.length > 0 ? (
        <BulkPanel
          selected={selected}
          categories={categories}
          seasons={seasons}
          canChangePrice={canChangePrice}
          onDone={() => {
            setSelected([]);
            setBulkOpen(false);
            setNotice(copy.bulk.done);
          }}
          onCancel={() => setBulkOpen(false)}
        />
      ) : null}
      <DataTable
        columns={columns}
        data={rows}
        caption={copy.title}
        empty={
          hasFilters
            ? copy.emptySearch
            : {
                ...copy.empty,
                action: (
                  <Link href="/productos/nuevo" className={buttonVariants()}>
                    {copy.new}
                  </Link>
                ),
              }
        }
      />
    </div>
  );
}
