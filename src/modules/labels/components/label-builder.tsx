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
import { browseLabelVariantsAction, searchLabelVariantsAction } from "@/modules/labels/actions";
import type { VariantOption, VariantPage } from "@/modules/purchasing/queries";
import { VariantPicker } from "@/modules/purchasing/components/variant-picker";

const copy = messages.labels.builder;

export type BuilderRow = {
  variantId: string;
  productName: string;
  label: string;
  sku: string;
  quantity: number;
};

const MAX_LABELS = 1000;

export function LabelBuilder({
  initial,
  firstPage,
}: {
  initial: BuilderRow[];
  /** La primera página de todas las prendas, para elegir mirando la lista. */
  firstPage: VariantPage;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<BuilderRow[]>(initial);
  const total = rows.reduce((sum, row) => sum + row.quantity, 0);

  function pick(option: VariantOption) {
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
            },
          ],
    );
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
      <VariantPicker
        onPick={pick}
        search={searchLabelVariantsAction}
        browse={{ initial: firstPage, load: browseLabelVariantsAction }}
      />

      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">{copy.empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableCaption className="sr-only">{copy.title}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>{copy.product}</TableHead>
                <TableHead>{copy.sku}</TableHead>
                <TableHead className="text-right">{copy.quantity}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const name = [row.productName, row.label].filter(Boolean).join(" · ");
                return (
                  <TableRow key={row.variantId}>
                    <TableCell>{name}</TableCell>
                    <TableCell className="font-mono text-xs">{row.sku}</TableCell>
                    <TableCell className="text-right">
                      <Input
                        aria-label={`${copy.quantity}: ${name}`}
                        type="number"
                        min={0}
                        step={1}
                        inputMode="numeric"
                        className="ml-auto w-24 text-right tabular-nums"
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
