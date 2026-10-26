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
import { messages } from "@/config/messages.es";
import { AUDIT_ACTIONS } from "@/lib/audit";
import { requirePageCapability } from "@/lib/auth";
import { formatLocalDateTime } from "@/lib/dates";
import { parseAuditFilters, type AuditFilters } from "@/modules/audit/schemas";
import { searchAuditLog } from "@/modules/audit/queries";
import { listUsers } from "@/modules/users/service";

const copy = messages.audit;

type AuditPageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function pageHref(filters: AuditFilters, page: number): string {
  const params = new URLSearchParams();
  if (filters.action) params.set("action", filters.action);
  if (filters.entityType) params.set("entityType", filters.entityType);
  if (filters.userId) params.set("userId", filters.userId);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/auditoria?${query}` : "/auditoria";
}

export default async function AuditPage({ searchParams }: AuditPageProps) {
  await requirePageCapability("audit.view");
  const filters = parseAuditFilters(await searchParams);
  const [result, users] = await Promise.all([searchAuditLog(filters), listUsers()]);

  return (
    <div className="space-y-6">
      <PageHeader title={copy.title} description={copy.description} />

      <form method="get" action="/auditoria" className="flex flex-wrap items-end gap-4">
        <FormField label={copy.filters.action} htmlFor="action">
          <NativeSelect id="action" name="action" defaultValue={filters.action ?? ""}>
            <option value="">{copy.filters.all}</option>
            {AUDIT_ACTIONS.map((action) => (
              <option key={action} value={action}>
                {copy.actions[action]}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label={copy.filters.user} htmlFor="userId">
          <NativeSelect id="userId" name="userId" defaultValue={filters.userId ?? ""}>
            <option value="">{copy.filters.all}</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label={copy.filters.entityType} htmlFor="entityType">
          <Input id="entityType" name="entityType" defaultValue={filters.entityType ?? ""} />
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
              <TableHead>{copy.columns.user}</TableHead>
              <TableHead>{copy.columns.action}</TableHead>
              <TableHead>{copy.columns.entity}</TableHead>
              <TableHead>{copy.columns.reason}</TableHead>
              <TableHead>{copy.columns.changes}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.rows.map((row) => {
              const hasChanges = row.before !== null || row.after !== null;
              return (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap">
                    {formatLocalDateTime(row.createdAt)}
                  </TableCell>
                  <TableCell>{row.user?.name ?? copy.system}</TableCell>
                  <TableCell>
                    {(copy.actions as Record<string, string>)[row.action] ?? row.action}
                  </TableCell>
                  <TableCell>
                    {row.entityType} <span className="text-muted-foreground">{row.entityId}</span>
                  </TableCell>
                  <TableCell>{row.reason ?? ""}</TableCell>
                  <TableCell>
                    {hasChanges ? (
                      <details>
                        <summary className="text-primary cursor-pointer">
                          {copy.showChanges}
                        </summary>
                        <pre className="bg-muted mt-2 max-w-xs overflow-x-auto rounded-md p-2 text-xs">
                          {JSON.stringify({ antes: row.before, después: row.after }, null, 2)}
                        </pre>
                      </details>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
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
              {copy.pagination.previous}
            </Link>
          ) : null}
          {result.page < result.pages ? (
            <Link
              href={pageHref(filters, result.page + 1)}
              className={buttonVariants({ variant: "outline" })}
            >
              {copy.pagination.next}
            </Link>
          ) : null}
        </div>
      </nav>
    </div>
  );
}
