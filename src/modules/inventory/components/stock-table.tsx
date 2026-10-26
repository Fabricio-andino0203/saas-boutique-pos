"use client";

import Link from "next/link";
import { Fragment, useState } from "react";

import { EmptyState } from "@/components/shared/empty-state";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { messages } from "@/config/messages.es";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { StockCell, StockRow, StockStatus } from "@/modules/inventory/types";

const copy = messages.inventory;

const STATUS_STYLE: Record<StockStatus, string> = {
  out: "bg-destructive/10 text-destructive",
  low: "bg-warning/15 text-warning",
  ok: "bg-muted text-muted-foreground",
};

function StatusBadge({ status }: { status: StockStatus }) {
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", STATUS_STYLE[status])}>
      {copy.status[status]}
    </span>
  );
}

/** Tallas en filas y colores en columnas; cada número lleva al kardex de esa variante. */
function Matrix({ cells }: { cells: StockCell[] }) {
  const sizes = [...new Set(cells.map((cell) => cell.sizeName))];
  const colors = [...new Set(cells.map((cell) => cell.colorName))];
  const find = (size: string | null, color: string | null) =>
    cells.find((cell) => cell.sizeName === size && cell.colorName === color);

  if (cells.length === 0) {
    return null;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{copy.matrix.sizes}</TableHead>
          {colors.map((color) => (
            <TableHead key={color ?? "-"} className="text-right">
              {color ?? copy.matrix.single}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {sizes.map((size) => (
          <TableRow key={size ?? "-"}>
            <TableCell className="font-medium">{size ?? copy.matrix.single}</TableCell>
            {colors.map((color) => {
              const cell = find(size, color);
              const label = [size, color].filter(Boolean).join(" · ") || copy.matrix.single;
              return (
                <TableCell key={color ?? "-"} className="text-right">
                  {cell ? (
                    <Link
                      href={`/inventario/kardex/${cell.variantId}`}
                      aria-label={`${copy.matrix.kardexOf} ${label}: ${cell.onHand}`}
                      title={
                        cell.reorderPoint !== null
                          ? `${copy.matrix.reorder}: ${cell.reorderPoint}`
                          : undefined
                      }
                      className={cn(
                        "inline-block min-w-9 rounded px-2 py-0.5 text-center tabular-nums underline-offset-4 hover:underline",
                        STATUS_STYLE[cell.status],
                      )}
                    >
                      {cell.onHand}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              );
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

type StockTableProps = {
  rows: StockRow[];
  showCost: boolean;
  filtered: boolean;
};

export function StockTable({ rows, showCost, filtered }: StockTableProps) {
  const [open, setOpen] = useState<string[]>([]);
  const toggle = (id: string) =>
    setOpen((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );

  if (rows.length === 0) {
    return <EmptyState {...(filtered ? copy.emptyFiltered : copy.empty)} />;
  }

  const heads = copy.columns;
  const columns = showCost ? 7 : 6;
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableCaption className="sr-only">{copy.title}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>{heads.product}</TableHead>
            <TableHead>{heads.category}</TableHead>
            <TableHead className="text-right">{heads.stock}</TableHead>
            <TableHead>{heads.status}</TableHead>
            {showCost ? <TableHead className="text-right">{heads.costValue}</TableHead> : null}
            <TableHead className="text-right">{heads.priceValue}</TableHead>
            <TableHead>{heads.details}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const expanded = open.includes(row.productId);
            return (
              <Fragment key={row.productId}>
                <TableRow>
                  <TableCell>
                    <div className="space-y-0.5">
                      <Link
                        href={`/productos/${row.productId}`}
                        className="text-primary font-medium underline underline-offset-4"
                      >
                        {row.name}
                      </Link>
                      <div className="text-muted-foreground font-mono text-xs">{row.code}</div>
                    </div>
                  </TableCell>
                  <TableCell>{row.categoryName}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.onHand}</TableCell>
                  <TableCell>
                    <StatusBadge status={row.status} />
                    {row.status === "ok" || !row.hasLowVariant ? null : (
                      <span className="sr-only"> ({copy.status.low})</span>
                    )}
                  </TableCell>
                  {showCost ? (
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(row.costValueCents ?? 0)}
                    </TableCell>
                  ) : null}
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(row.priceValueCents)}
                  </TableCell>
                  <TableCell>
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-label={`${expanded ? copy.hideSizes : copy.showSizes}: ${row.name}`}
                      className="text-primary underline underline-offset-4"
                      onClick={() => toggle(row.productId)}
                    >
                      {expanded ? copy.hideSizes : copy.showSizes}
                    </button>
                  </TableCell>
                </TableRow>
                {expanded ? (
                  <TableRow>
                    <TableCell colSpan={columns} className="bg-muted/30">
                      <Matrix cells={row.cells} />
                    </TableCell>
                  </TableRow>
                ) : null}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
