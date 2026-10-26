import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
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
import { requirePageCapability } from "@/lib/auth";
import { formatLocalDateTime } from "@/lib/dates";
import { listCounts } from "@/modules/inventory/count-queries";
import { CountStatusBadge } from "@/modules/inventory/components/count-status-badge";
import { NewCountForm } from "@/modules/inventory/components/new-count-form";
import { getFormOptions } from "@/modules/products/service";

export default async function CountsPage() {
  await requirePageCapability("stock.adjust");
  const [counts, options] = await Promise.all([listCounts(), getFormOptions()]);
  const copy = messages.counts;
  const heads = copy.columns;
  const inProgress = counts.some(
    (count) => count.status === "OPEN" || count.status === "IN_REVIEW",
  );

  return (
    <div className="space-y-6">
      <PageHeader title={copy.title} description={copy.description} />

      {inProgress ? null : <NewCountForm categories={options.categories} />}

      {counts.length === 0 ? (
        <EmptyState title={copy.empty.title} description={copy.empty.description} />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableCaption className="sr-only">{copy.title}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>{heads.date}</TableHead>
                <TableHead>{heads.scope}</TableHead>
                <TableHead>{heads.status}</TableHead>
                <TableHead>{heads.by}</TableHead>
                <TableHead className="text-right">{heads.items}</TableHead>
                <TableHead className="text-right">{heads.counted}</TableHead>
                <TableHead className="text-right">{heads.differences}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {counts.map((count) => (
                <TableRow key={count.id}>
                  <TableCell>
                    <Link
                      href={`/inventario/conteos/${count.id}`}
                      className="text-primary font-medium underline underline-offset-4"
                    >
                      {formatLocalDateTime(count.createdAt)}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {count.scope === "CATEGORY"
                      ? `${copy.scope.CATEGORY}: ${count.scopeName}`
                      : copy.scope.ALL}
                  </TableCell>
                  <TableCell>
                    <CountStatusBadge status={count.status} />
                  </TableCell>
                  <TableCell>{count.startedByName}</TableCell>
                  <TableCell className="text-right tabular-nums">{count.items}</TableCell>
                  <TableCell className="text-right tabular-nums">{count.counted}</TableCell>
                  <TableCell className="text-right tabular-nums">{count.differences}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
