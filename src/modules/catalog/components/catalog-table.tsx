"use client";

import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { useMemo } from "react";

import { DataTable } from "@/components/shared/data-table";
import { messages } from "@/config/messages.es";
import {
  CATALOG_CONFIG,
  columnLabel,
  type CatalogEntity,
  type ItemRow,
} from "@/modules/catalog/config";

function Swatch({ hex }: { hex: string }) {
  if (!hex) {
    return null;
  }
  return (
    <span className="inline-flex items-center gap-2">
      <span
        aria-hidden="true"
        className="border-border size-4 rounded-full border"
        style={{ backgroundColor: hex }}
      />
      {hex}
    </span>
  );
}

function buildColumns(entity: CatalogEntity): ColumnDef<ItemRow>[] {
  const copy = messages.catalog;
  return [
    ...CATALOG_CONFIG[entity].columns.map((key): ColumnDef<ItemRow> => ({
      id: key,
      header: columnLabel(key),
      cell: ({ row }) =>
        key === "hex" ? (
          <Swatch hex={row.original.values[key] ?? ""} />
        ) : (
          (row.original.values[key] ?? "")
        ),
    })),
    {
      id: "status",
      header: copy.status.column,
      cell: ({ row }) => (row.original.archived ? copy.status.archived : copy.status.active),
    },
    {
      id: "actions",
      header: messages.users.columns.actions,
      cell: ({ row }) => (
        <Link
          href={`/catalogos/${entity}/${row.original.id}`}
          aria-label={`${copy.actions.edit} ${row.original.values.name ?? ""}`}
          className="text-primary underline underline-offset-4"
        >
          {copy.actions.edit}
        </Link>
      ),
    },
  ];
}

export function CatalogTable({ entity, rows }: { entity: CatalogEntity; rows: ItemRow[] }) {
  const labels = messages.catalog.entities[entity];
  const columns = useMemo(() => buildColumns(entity), [entity]);

  return (
    <DataTable
      columns={columns}
      data={rows}
      caption={labels.plural}
      empty={{ title: labels.emptyTitle, description: labels.emptyDescription }}
    />
  );
}
