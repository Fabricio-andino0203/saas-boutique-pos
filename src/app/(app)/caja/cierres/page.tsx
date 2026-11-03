import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { Notice } from "@/components/shared/notice";
import { PageHeader } from "@/components/shared/page-header";
import { buttonVariants } from "@/components/ui/button";
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
import { formatMoney } from "@/lib/format";
import { hasCapability } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { CashStatusBadge } from "@/modules/cash/components/cash-status-badge";
import { countPendingApprovals, listCashSessions } from "@/modules/cash/queries";

const first = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? "";

export default async function CashClosingsPage({
  searchParams,
}: {
  searchParams: Promise<{ pagina?: string }>;
}) {
  const { user } = await requirePageCapability("cash.open");
  const seeAll = hasCapability(user.role, "cash.viewOthers");
  const page = Math.max(1, Number.parseInt(first((await searchParams).pagina), 10) || 1);
  const copy = messages.cash.list;

  const [sessions, pending] = await Promise.all([
    listCashSessions({ userId: seeAll ? undefined : user.id, page }),
    hasCapability(user.role, "cash.closeApprove") ? countPendingApprovals() : Promise.resolve(0),
  ]);
  const lastPage = Math.max(1, Math.ceil(sessions.total / sessions.pageSize));
  const heads = copy.columns;

  return (
    <div className="space-y-6">
      <PageHeader
        title={copy.title}
        description={copy.description}
        actions={
          <Link href="/caja" className={buttonVariants({ variant: "outline" })}>
            {copy.goToCash}
          </Link>
        }
      />
      {pending > 0 ? (
        <Notice tone="warning">
          <span className="font-semibold tabular-nums">{pending}</span>{" "}
          {pending === 1 ? copy.pendingOne : copy.pending}
        </Notice>
      ) : null}

      {sessions.rows.length === 0 ? (
        <EmptyState title={copy.empty.title} description={copy.empty.description} />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableCaption className="sr-only">{copy.title}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>{heads.opened}</TableHead>
                <TableHead>{heads.cashier}</TableHead>
                <TableHead>{heads.terminal}</TableHead>
                <TableHead>{heads.status}</TableHead>
                <TableHead className="text-right">{heads.expected}</TableHead>
                <TableHead className="text-right">{heads.counted}</TableHead>
                <TableHead className="text-right">{heads.difference}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Link
                      href={`/caja/cierres/${row.id}`}
                      className="text-primary font-medium underline underline-offset-4"
                    >
                      {formatLocalDateTime(row.openedAt)}
                    </Link>
                  </TableCell>
                  <TableCell>{row.userName}</TableCell>
                  <TableCell>{row.terminalName}</TableCell>
                  <TableCell>
                    <CashStatusBadge status={row.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.expectedCashCents === null ? "—" : formatMoney(row.expectedCashCents)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.countedCashCents === null ? "—" : formatMoney(row.countedCashCents)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right tabular-nums",
                      row.differenceCents !== null &&
                        row.differenceCents !== 0 &&
                        "text-destructive",
                    )}
                  >
                    {row.differenceCents === null ? "—" : formatMoney(row.differenceCents)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {lastPage > 1 ? (
        <nav
          aria-label={messages.audit.pagination.next}
          className="flex items-center justify-between text-sm"
        >
          {page > 1 ? (
            <Link href={`/caja/cierres?pagina=${page - 1}`} className="underline">
              {messages.audit.pagination.previous}
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted-foreground">
            {page} / {lastPage}
          </span>
          {page < lastPage ? (
            <Link href={`/caja/cierres?pagina=${page + 1}`} className="underline">
              {messages.audit.pagination.next}
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}
