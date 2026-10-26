"use client";

import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";

import { DataTable } from "@/components/shared/data-table";
import { messages } from "@/config/messages.es";

export type UserRow = {
  id: string;
  name: string;
  username: string;
  role: string;
  status: string;
  lastLogin: string;
};

const copy = messages.users.columns;

const columns: ColumnDef<UserRow>[] = [
  { accessorKey: "name", header: copy.name },
  { accessorKey: "username", header: copy.username },
  { accessorKey: "role", header: copy.role },
  { accessorKey: "status", header: copy.status },
  { accessorKey: "lastLogin", header: copy.lastLogin },
  {
    id: "actions",
    header: copy.actions,
    cell: ({ row }) => (
      <Link
        href={`/usuarios/${row.original.id}`}
        aria-label={`${messages.users.edit} ${row.original.name}`}
        className="text-primary underline underline-offset-4"
      >
        {messages.users.edit}
      </Link>
    ),
  },
];

export function UsersTable({ rows }: { rows: UserRow[] }) {
  return <DataTable columns={columns} data={rows} caption={messages.users.title} />;
}
