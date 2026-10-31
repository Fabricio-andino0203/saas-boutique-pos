import { Eraser, Filter } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { FormField } from "@/components/shared/form-field";
import { NativeSelect } from "@/components/shared/native-select";
import { PageHeader } from "@/components/shared/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
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
import { platformMessages } from "@/config/messages.platform.es";
import { formatLocalDateTime } from "@/lib/dates";
import { requirePlatformSession } from "@/lib/platform-auth";
import { PLATFORM_AUDIT_ACTIONS } from "@/modules/platform/audit";
import { searchPlatformAudit } from "@/modules/platform/queries";
import { parsePlatformAuditFilters, type PlatformAuditFilters } from "@/modules/platform/schemas";

const copy = platformMessages.audit;
const actionLabels: Record<string, string> = copy.actions;

type AuditPageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function pageHref(filters: PlatformAuditFilters, page: number): string {
  const params = new URLSearchParams();
  if (filters.action) params.set("action", filters.action);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/auditoria?${query}` : "/auditoria";
}

export default async function PlatformAuditPage({ searchParams }: AuditPageProps) {
  await requirePlatformSession();
  const filters = parsePlatformAuditFilters(await searchParams);
  const result = await searchPlatformAudit(filters);

  return (
    <div className="space-y-6">
      <PageHeader title={copy.title} description={copy.description} />

      <form method="get" action="/auditoria" className="flex flex-wrap items-end gap-4">
        <FormField label={copy.filters.action} htmlFor="action">
          <NativeSelect id="action" name="action" defaultValue={filters.action ?? ""}>
            <option value="">{copy.filters.all}</option>
            {PLATFORM_AUDIT_ACTIONS.map((action) => (
              <option key={action} value={action}>
                {actionLabels[action]}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label={copy.filters.from} htmlFor="from">
          <Input id="from" name="from" type="date" defaultValue={filters.from ?? ""} />
        </FormField>
        <FormField label={copy.filters.to} htmlFor="to">
          <Input id="to" name="to" type="date" defaultValue={filters.to ?? ""} />
        </FormField>
        <div className="flex gap-2">
          <Button type="submit">
            <Filter aria-hidden="true" />
            {copy.filters.apply}
          </Button>
          <Link href="/auditoria" className={buttonVariants({ variant: "outline" })}>
            <Eraser aria-hidden="true" />
            {copy.filters.clear}
          </Link>
        </div>
      </form>

      {result.rows.length === 0 ? (
        <EmptyState title={copy.empty.title} description={copy.empty.description} />
      ) : (
        <Table>
          <TableCaption className="sr-only">{copy.title}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{copy.columns.date}</TableHead>
              <TableHead>{copy.columns.actor}</TableHead>
              <TableHead>{copy.columns.action}</TableHead>
              <TableHead>{copy.columns.target}</TableHead>
              <TableHead>{copy.columns.ip}</TableHead>
              <TableHead>{copy.columns.details}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="whitespace-nowrap">{formatLocalDateTime(row.at)}</TableCell>
                <TableCell>{row.actorUsername ? `@${row.actorUsername}` : copy.system}</TableCell>
                <TableCell>{actionLabels[row.action] ?? row.action}</TableCell>
                <TableCell>
                  {row.targetType ? (
                    <>
                      {row.targetType} <span className="text-muted-foreground">{row.targetId}</span>
                    </>
                  ) : null}
                </TableCell>
                <TableCell>{row.ip ?? ""}</TableCell>
                <TableCell>
                  {row.details ? (
                    <details>
                      <summary className="text-primary cursor-pointer">{copy.showDetails}</summary>
                      <pre className="bg-muted mt-2 max-w-xs overflow-x-auto rounded-md p-2 text-xs">
                        {JSON.stringify(row.details, null, 2)}
                      </pre>
                    </details>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <nav aria-label={copy.title} className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          {result.page} / {result.pages}
        </span>
        <div className="flex gap-2">
          {result.page > 1 ? (
            <Link
              href={pageHref(filters, result.page - 1)}
              className={buttonVariants({ variant: "outline" })}
            >
              {copy.previous}
            </Link>
          ) : null}
          {result.page < result.pages ? (
            <Link
              href={pageHref(filters, result.page + 1)}
              className={buttonVariants({ variant: "outline" })}
            >
              {copy.next}
            </Link>
          ) : null}
        </div>
      </nav>
    </div>
  );
}
