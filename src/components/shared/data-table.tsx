"use client";

import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import type { ReactNode } from "react";

import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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

type DataTableProps<TData, TValue> = {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  isLoading?: boolean;
  loadingRows?: number;
  error?: { message: string; onRetry: () => void } | null;
  empty?: { title: string; description?: string; action?: ReactNode };
  caption: string;
};

export function DataTable<TData, TValue>({
  columns,
  data,
  isLoading = false,
  loadingRows = 5,
  error = null,
  empty,
  caption,
}: DataTableProps<TData, TValue>) {
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table v8 devuelve funciones no memoizables; aceptado (§20.3, fila 2)
  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel() });

  if (isLoading) {
    return (
      <div role="status" className="space-y-2">
        <span className="sr-only">{messages.common.loading}</span>
        {Array.from({ length: loadingRows }, (_, index) => (
          <Skeleton key={index} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="border-divider space-y-3 rounded-lg border p-6 text-center">
        <p>{error.message}</p>
        <Button variant="outline" onClick={error.onRetry}>
          {messages.common.retry}
        </Button>
      </div>
    );
  }

  const rows = table.getRowModel().rows;

  if (rows.length === 0) {
    return (
      <EmptyState title={empty?.title ?? messages.states.empty.title} action={empty?.action} />
    );
  }

  return (
    <Table>
      <TableCaption className="sr-only">{caption}</TableCaption>
      <TableHeader>
        {table.getHeaderGroups().map((headerGroup) => (
          <TableRow key={headerGroup.id}>
            {headerGroup.headers.map((header) => (
              <TableHead key={header.id}>
                {header.isPlaceholder
                  ? null
                  : flexRender(header.column.columnDef.header, header.getContext())}
              </TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            {row.getVisibleCells().map((cell) => (
              <TableCell key={cell.id}>
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
