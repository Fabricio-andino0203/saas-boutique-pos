import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { Notice } from "@/components/shared/notice";
import { PageHeader } from "@/components/shared/page-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { messages } from "@/config/messages.es";
import { requirePageCapability } from "@/lib/auth";
import { formatLocalDate, formatLocalDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { hasCapability } from "@/lib/permissions";
import { BoxWithdrawalButton } from "@/modules/finance/components/box-withdrawal-button";
import { VoidEntryButton } from "@/modules/finance/components/void-entry-button";
import { BOX_LIST_LIMIT, getFinanceBox } from "@/modules/finance/queries";
import { StatFigure } from "@/modules/reports/components/stat-card";

const copy = messages.finance.box;
const withdrawCopy = copy.withdraw;

export default async function FinanceBoxPage() {
  const { user } = await requirePageCapability("finance.view");
  const box = await getFinanceBox();
  const canWrite = hasCapability(user.role, "finance.write");
  const canVoid = hasCapability(user.role, "finance.void");

  return (
    <div className="space-y-8">
      <PageHeader
        title={copy.title}
        description={copy.description}
        actions={canWrite ? <BoxWithdrawalButton balanceCents={box.balanceCents} /> : undefined}
      />

      <div className="stagger border-divider grid gap-6 border-b pb-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:items-end">
        <div role="group" aria-label={copy.balance} className="space-y-2">
          <p className="text-muted-foreground text-sm">{copy.balance}</p>
          <p
            className={cn(
              "font-heading text-4xl font-bold tracking-tight tabular-nums sm:text-5xl",
              box.needsReview ? "text-destructive" : "text-heading",
            )}
          >
            {formatMoney(box.balanceCents)}
          </p>
        </div>
        <div className="grid gap-6 sm:grid-cols-2">
          <StatFigure
            divided={false}
            label={copy.figures.deposits}
            value={formatMoney(box.depositsCents)}
          />
          <StatFigure
            divided={false}
            label={copy.figures.income}
            value={formatMoney(box.cashIncomeCents)}
          />
          <StatFigure
            divided={false}
            label={copy.figures.expenses}
            value={formatMoney(box.cashExpenseCents)}
          />
          <StatFigure
            divided={false}
            label={copy.figures.withdrawals}
            value={formatMoney(box.withdrawalsCents)}
          />
        </div>
      </div>

      {box.needsReview ? (
        <Notice tone="warning">
          {copy.review}{" "}
          <Link
            href="/finanzas/movimientos?rango=year&pago=CASH_OTHER&tipo=EXPENSE"
            className="underline underline-offset-4"
          >
            {copy.reviewLink}
          </Link>
        </Notice>
      ) : null}

      <section aria-labelledby="box-deposits-title" className="space-y-3">
        <h2 id="box-deposits-title" className="text-lg font-medium">
          {copy.depositsTitle}
        </h2>
        {box.deposits.length === 0 ? (
          <EmptyState title={copy.depositsEmpty} description={copy.depositsEmptyHint} />
        ) : (
          <div className="bg-card overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{copy.columns.date}</TableHead>
                  <TableHead>{copy.columns.terminal}</TableHead>
                  <TableHead>{copy.columns.closedBy}</TableHead>
                  <TableHead className="text-right">{copy.columns.amount}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {box.deposits.map((deposit) => (
                  <TableRow key={deposit.cashSessionId}>
                    <TableCell>{formatLocalDateTime(deposit.closedAt)}</TableCell>
                    <TableCell>{deposit.terminalName}</TableCell>
                    <TableCell>{deposit.closedByName}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(deposit.amountCents)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/caja/cierres/${deposit.cashSessionId}`}
                        className="text-primary text-sm underline underline-offset-4"
                      >
                        {copy.viewClosing}
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {box.depositCount > BOX_LIST_LIMIT ? (
          <p className="text-muted-foreground text-sm">{copy.truncated}</p>
        ) : null}
        <p className="text-muted-foreground text-sm">{copy.note}</p>
      </section>

      <section aria-labelledby="box-withdrawals-title" className="space-y-3">
        <h2 id="box-withdrawals-title" className="text-lg font-medium">
          {withdrawCopy.listTitle}
        </h2>
        {box.withdrawals.length === 0 ? (
          <EmptyState title={withdrawCopy.empty} />
        ) : (
          <div className="bg-card overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{withdrawCopy.columns.date}</TableHead>
                  <TableHead>{withdrawCopy.columns.reason}</TableHead>
                  <TableHead>{withdrawCopy.columns.by}</TableHead>
                  <TableHead className="text-right">{withdrawCopy.columns.amount}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {box.withdrawals.map((row) => {
                  const summary = `${row.reason} (${formatMoney(row.amountCents)})`;
                  return (
                    <TableRow key={row.id} className={cn(row.voidedAt && "text-muted-foreground")}>
                      <TableCell>{formatLocalDate(row.occurredAt)}</TableCell>
                      <TableCell>
                        <span className={cn(row.voidedAt && "line-through")}>{row.reason}</span>
                        {row.voidedAt ? (
                          <p className="text-xs">
                            <span className="font-medium">{withdrawCopy.voided}</span>
                            {" · "}
                            {withdrawCopy.voidedBecause}: {row.voidReason}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell>{row.createdByName}</TableCell>
                      <TableCell
                        className={cn("text-right tabular-nums", row.voidedAt && "line-through")}
                      >
                        {formatMoney(row.amountCents)}
                      </TableCell>
                      <TableCell className="text-right">
                        {canVoid && !row.voidedAt ? (
                          <VoidEntryButton entryId={row.id} summary={summary} kind="withdrawal" />
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        {box.withdrawalCount > BOX_LIST_LIMIT ? (
          <p className="text-muted-foreground text-sm">{withdrawCopy.truncated}</p>
        ) : null}
      </section>
    </div>
  );
}
