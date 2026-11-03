import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
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
import { formatMoney } from "@/lib/format";
import { hasCapability } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { ArchiveFixedCostButton } from "@/modules/finance/components/archive-fixed-cost-button";
import { FixedCostDialog } from "@/modules/finance/components/fixed-cost-dialog";
import { PayFixedCostButton } from "@/modules/finance/components/pay-fixed-cost-button";
import { formatPeriodTitle } from "@/modules/finance/periods";
import { listFinanceCategories, listFixedCosts } from "@/modules/finance/queries";

const copy = messages.finance.fixed;

const first = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? "";

/** `2026-11-05` → `05/11/2026` (el formato de las demás pantallas). */
const showDate = (key: string): string => key.split("-").reverse().join("/");

export default async function FixedCostsPage({
  searchParams,
}: {
  searchParams: Promise<{ archivados?: string }>;
}) {
  const { user } = await requirePageCapability("finance.view");
  const includeArchived = first((await searchParams).archivados) === "1";
  const canWrite = hasCapability(user.role, "finance.write");

  const [{ costs, pending }, categories] = await Promise.all([
    listFixedCosts({ includeArchived }),
    listFinanceCategories({ type: "EXPENSE" }),
  ]);
  const hasArchived = costs.some((cost) => cost.archived);

  return (
    <div className="space-y-8">
      <PageHeader
        title={copy.title}
        description={copy.description}
        actions={canWrite ? <FixedCostDialog categories={categories} /> : undefined}
      />

      <section aria-labelledby="pending-title" className="space-y-3">
        <div className="space-y-1">
          <h2 id="pending-title" className="text-lg font-medium">
            {copy.pendingTitle}
          </h2>
          <p className="text-muted-foreground text-sm">{copy.pendingHint}</p>
        </div>
        {pending.length === 0 ? (
          <p role="status" className="text-muted-foreground text-sm">
            {copy.pendingEmpty}
          </p>
        ) : (
          <div className="bg-card overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{copy.columns.name}</TableHead>
                  <TableHead>{copy.columns.month}</TableHead>
                  <TableHead>{copy.columns.due}</TableHead>
                  <TableHead className="text-right">{copy.columns.amount}</TableHead>
                  {canWrite ? (
                    <TableHead>
                      <span className="sr-only">{copy.columns.actions}</span>
                    </TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map((row) => (
                  <TableRow key={`${row.fixedCostId}-${row.period}`}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell>{formatPeriodTitle(row.period)}</TableCell>
                    <TableCell className="tabular-nums">
                      {showDate(row.dueDate)}
                      {row.overdue ? (
                        <span className="bg-destructive/10 text-destructive ml-2 rounded-full px-2 py-0.5 text-xs">
                          {copy.overdue}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatMoney(row.amountCents)}
                    </TableCell>
                    {canWrite ? (
                      <TableCell className="text-right">
                        <PayFixedCostButton
                          fixedCostId={row.fixedCostId}
                          name={row.name}
                          period={row.period}
                          amountCents={row.amountCents}
                        />
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section aria-labelledby="costs-title" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="costs-title" className="text-lg font-medium">
            {copy.listTitle}
          </h2>
          {hasArchived || includeArchived ? (
            <Link
              href={
                includeArchived ? "/finanzas/costos-fijos" : "/finanzas/costos-fijos?archivados=1"
              }
              className="text-primary text-sm underline underline-offset-4"
            >
              {includeArchived ? copy.hideArchived : copy.showArchived}
            </Link>
          ) : null}
        </div>
        {costs.length === 0 ? (
          <EmptyState title={copy.listEmpty} />
        ) : (
          <div className="bg-card overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{copy.columns.name}</TableHead>
                  <TableHead>{copy.columns.category}</TableHead>
                  <TableHead className="text-right">{copy.columns.monthly}</TableHead>
                  <TableHead>{copy.columns.day}</TableHead>
                  <TableHead>{copy.columns.period}</TableHead>
                  <TableHead>{copy.columns.status}</TableHead>
                  {canWrite ? (
                    <TableHead>
                      <span className="sr-only">{copy.columns.actions}</span>
                    </TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {costs.map((cost) => (
                  <TableRow key={cost.id} className={cn(cost.archived && "text-muted-foreground")}>
                    <TableCell className="font-medium">{cost.name}</TableCell>
                    <TableCell>{cost.categoryName}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(cost.amountCents)}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {copy.dayOfMonth} {cost.dueDay}
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      {copy.since} {formatPeriodTitle(cost.startsOn)}
                      {cost.endsOn ? (
                        <>
                          {" "}
                          {copy.until} {formatPeriodTitle(cost.endsOn)}
                        </>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {cost.archived ? (
                        <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">
                          {copy.archived}
                        </span>
                      ) : cost.pendingCount > 0 ? (
                        <span className="tabular-nums">
                          {cost.pendingCount} {copy.pendingCount}
                        </span>
                      ) : (
                        <span className="text-success">{copy.upToDate}</span>
                      )}
                    </TableCell>
                    {canWrite ? (
                      <TableCell className="text-right whitespace-nowrap">
                        {!cost.archived ? (
                          <FixedCostDialog
                            categories={categories}
                            editing={{
                              id: cost.id,
                              name: cost.name,
                              categoryId: cost.categoryId,
                              amountCents: cost.amountCents,
                              dueDay: cost.dueDay,
                              startsOn: cost.startsOn,
                              endsOn: cost.endsOn,
                            }}
                          />
                        ) : null}
                        <ArchiveFixedCostButton
                          fixedCostId={cost.id}
                          name={cost.name}
                          archived={cost.archived}
                        />
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
