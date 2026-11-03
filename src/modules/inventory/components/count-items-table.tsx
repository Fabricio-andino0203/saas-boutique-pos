"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

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
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { setCountedQtyAction } from "@/modules/inventory/count-actions";
import type { CountItemRow } from "@/modules/inventory/count-queries";

const copy = messages.counts;

type CountItemsTableProps = {
  rows: CountItemRow[];
  editable: boolean;
  showCost: boolean;
  /** Avisar cuando el sistema cambió desde que se abrió el conteo (revisión y aplicado). */
  showCurrent: boolean;
};

function CountedCell({ row, editable }: { row: CountItemRow; editable: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  if (!editable) {
    return <span className="tabular-nums">{row.countedQty}</span>;
  }
  const name = [row.productName, row.label].filter(Boolean).join(" · ");
  return (
    <div className="flex flex-col items-end gap-1">
      <Input
        key={`${row.itemId}-${row.countedQty}`}
        aria-label={`${copy.columns.countedQty}: ${name}`}
        type="number"
        min={0}
        step={1}
        inputMode="numeric"
        className="w-24 text-right tabular-nums"
        defaultValue={row.countedQty}
        onBlur={async (event) => {
          const value = Number(event.target.value);
          if (event.target.value.trim() === "" || value === row.countedQty) {
            return;
          }
          const result = await setCountedQtyAction(row.itemId, value);
          setError(result?.error ?? null);
          if (result?.success) {
            router.refresh();
          }
        }}
      />
      {error ? (
        <Notice tone="error" size="sm" className="max-w-40">
          {error}
        </Notice>
      ) : null}
    </div>
  );
}

export function CountItemsTable({ rows, editable, showCost, showCurrent }: CountItemsTableProps) {
  const heads = copy.columns;
  if (rows.length === 0) {
    return <p className="text-muted-foreground text-sm">{copy.items.empty}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableCaption className="sr-only">{copy.items.title}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>{heads.product}</TableHead>
            <TableHead>{heads.sku}</TableHead>
            <TableHead className="text-right">{heads.expected}</TableHead>
            <TableHead className="text-right">{heads.countedQty}</TableHead>
            <TableHead className="text-right">{heads.difference}</TableHead>
            {showCurrent ? <TableHead className="text-right">{heads.current}</TableHead> : null}
            {showCost ? <TableHead className="text-right">{heads.value}</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.itemId}>
              <TableCell>{[row.productName, row.label].filter(Boolean).join(" · ")}</TableCell>
              <TableCell className="font-mono text-xs">{row.sku}</TableCell>
              <TableCell className="text-right tabular-nums">{row.expectedQty}</TableCell>
              <TableCell className="text-right">
                <CountedCell row={row} editable={editable} />
              </TableCell>
              <TableCell
                className={cn(
                  "text-right tabular-nums",
                  row.difference < 0 && "text-destructive",
                  row.difference > 0 && "text-success",
                )}
              >
                {row.difference > 0
                  ? `+${row.difference}`
                  : row.difference < 0
                    ? `−${Math.abs(row.difference)}`
                    : "0"}
              </TableCell>
              {showCurrent ? (
                <TableCell
                  className={cn(
                    "text-right tabular-nums",
                    row.currentQty !== row.expectedQty && "text-warning font-medium",
                  )}
                >
                  {row.currentQty}
                </TableCell>
              ) : null}
              {showCost ? (
                <TableCell className="text-right tabular-nums">
                  {formatMoney(row.valueCents ?? 0)}
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
