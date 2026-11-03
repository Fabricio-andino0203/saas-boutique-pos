"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Notice } from "@/components/shared/notice";
import { messages } from "@/config/messages.es";
import {
  browseLabelVariantsAction,
  searchLabelVariantsAction,
  type LabelVariantOption,
  type LabelVariantPage,
} from "@/modules/labels/actions";
import { ProductLabelPicker } from "@/modules/labels/components/product-label-picker";
import { VariantPicker } from "@/modules/purchasing/components/variant-picker";

const copy = messages.labels.builder;

export type BuilderRow = {
  variantId: string;
  productName: string;
  label: string;
  sku: string;
  quantity: number;
  /** Las unidades que hay ahora; `null` si no se sabe. */
  onHand: number | null;
};

const MAX_LABELS = 1000;

const stockQuantity = (row: BuilderRow): number => Math.max(0, row.onHand ?? row.quantity);

export function LabelBuilder({
  initial,
  firstPage,
}: {
  initial: BuilderRow[];
  /** La primera página de todas las prendas, para elegir mirando la lista. */
  firstPage: LabelVariantPage;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<BuilderRow[]>(initial);
  const total = rows.reduce((sum, row) => sum + row.quantity, 0);
  const anyStock = rows.some((row) => row.onHand !== null);

  function pick(option: LabelVariantOption) {
    setRows((current) =>
      current.some((row) => row.variantId === option.variantId)
        ? current.map((row) =>
            row.variantId === option.variantId ? { ...row, quantity: row.quantity + 1 } : row,
          )
        : [
            ...current,
            {
              variantId: option.variantId,
              productName: option.productName,
              label: option.label,
              sku: option.sku,
              quantity: 1,
              onHand: option.onHand,
            },
          ],
    );
  }

  /** Agrega las prendas de un producto; las que ya estaban en la lista no se tocan. Devuelve cuántas eran nuevas. */
  function addMany(incoming: BuilderRow[]): number {
    const known = new Set(rows.map((row) => row.variantId));
    const fresh = incoming.filter((row) => !known.has(row.variantId));
    if (fresh.length > 0) {
      setRows((current) => [...current, ...fresh]);
    }
    return fresh.length;
  }

  function print() {
    const query = new URLSearchParams();
    for (const row of rows) {
      if (row.quantity > 0) {
        query.append("v", `${row.variantId}:${row.quantity}`);
      }
    }
    router.push(`/etiquetas/imprimir?${query.toString()}`);
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-medium">{copy.title}</h2>
        <p className="text-muted-foreground text-sm">{copy.hint}</p>
      </div>
      <ProductLabelPicker onAdd={addMany} />
      <VariantPicker
        onPick={pick}
        search={searchLabelVariantsAction}
        browse={{ initial: firstPage, load: browseLabelVariantsAction }}
      />

      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">{copy.empty}</p>
      ) : (
        <>
          {anyStock ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setRows((current) =>
                    current.map((row) => ({ ...row, quantity: stockQuantity(row) })),
                  )
                }
              >
                {copy.allToStock}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setRows((current) => current.map((row) => ({ ...row, quantity: 1 })))
                }
              >
                {copy.oneEach}
              </Button>
            </div>
          ) : null}
          <div className="overflow-x-auto">
            <Table>
              <TableCaption className="sr-only">{copy.title}</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>{copy.product}</TableHead>
                  <TableHead>{copy.sku}</TableHead>
                  <TableHead className="text-right">{copy.stock}</TableHead>
                  <TableHead className="text-right">{copy.quantity}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const name = [row.productName, row.label].filter(Boolean).join(" · ");
                  const noStock = row.onHand !== null && row.onHand <= 0;
                  const above = row.onHand !== null && row.onHand > 0 && row.quantity > row.onHand;
                  return (
                    <TableRow key={row.variantId}>
                      <TableCell>{name}</TableCell>
                      <TableCell className="font-mono text-xs">{row.sku}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.onHand === null ? (
                          "—"
                        ) : noStock ? (
                          <span className="text-muted-foreground">{copy.noStock}</span>
                        ) : (
                          row.onHand
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {row.onHand !== null && row.quantity !== stockQuantity(row) ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="xs"
                              aria-label={`${copy.useStock}: ${name}`}
                              onClick={() =>
                                setRows((current) =>
                                  current.map((item) =>
                                    item.variantId === row.variantId
                                      ? { ...item, quantity: stockQuantity(item) }
                                      : item,
                                  ),
                                )
                              }
                            >
                              {copy.useStock}
                            </Button>
                          ) : null}
                          <Input
                            aria-label={`${copy.quantity}: ${name}`}
                            type="number"
                            min={0}
                            step={1}
                            inputMode="numeric"
                            className="w-24 text-right tabular-nums"
                            value={row.quantity}
                            onChange={(event) =>
                              setRows((current) =>
                                current.map((item) =>
                                  item.variantId === row.variantId
                                    ? {
                                        ...item,
                                        quantity: Math.max(
                                          0,
                                          Math.trunc(Number(event.target.value) || 0),
                                        ),
                                      }
                                    : item,
                                ),
                              )
                            }
                          />
                        </div>
                        {above ? (
                          <p className="text-warning mt-1 text-xs">{copy.aboveStock}</p>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <button
                          type="button"
                          className="text-muted-foreground underline underline-offset-4"
                          aria-label={`${copy.remove}: ${name}`}
                          onClick={() =>
                            setRows((current) =>
                              current.filter((item) => item.variantId !== row.variantId),
                            )
                          }
                        >
                          {copy.remove}
                        </button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      <p className="font-medium tabular-nums">
        {total} <span className="font-normal">{copy.total}</span>
      </p>
      {total > MAX_LABELS ? <Notice tone="error">{copy.tooMany}</Notice> : null}
      <Button type="button" disabled={total === 0 || total > MAX_LABELS} onClick={print}>
        {copy.print}
      </Button>
    </div>
  );
}
