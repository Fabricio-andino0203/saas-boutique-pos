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
import { formatLocalDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BOX_DEPOSIT_LIMIT, getFinanceBox } from "@/modules/finance/queries";
import { StatFigure } from "@/modules/reports/components/stat-card";

const copy = messages.finance.box;

export default async function FinanceBoxPage() {
  await requirePageCapability("finance.view");
  const box = await getFinanceBox();

  return (
    <div className="space-y-8">
      <PageHeader title={copy.title} description={copy.description} />

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
        <div className="grid gap-6 sm:grid-cols-3">
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
        {box.depositCount > BOX_DEPOSIT_LIMIT ? (
          <p className="text-muted-foreground text-xs">{copy.truncated}</p>
        ) : null}
        <p className="text-muted-foreground text-xs">{copy.note}</p>
      </section>
    </div>
  );
}
