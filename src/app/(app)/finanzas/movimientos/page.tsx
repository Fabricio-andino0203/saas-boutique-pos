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
import { formatLocalDate } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { hasCapability } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { EntryFilters } from "@/modules/finance/components/entry-filters";
import { FinanceExportLinks } from "@/modules/finance/components/finance-export-links";
import { NewEntryButton } from "@/modules/finance/components/new-entry-button";
import { VoidEntryButton } from "@/modules/finance/components/void-entry-button";
import {
  listFinanceCategories,
  listFinanceEntries,
  listSupplierOptions,
} from "@/modules/finance/queries";
import { ALL_PAYMENT_METHODS, FINANCE_ENTRY_TYPES } from "@/modules/finance/schemas";
import { RangeFilter } from "@/modules/reports/components/range-filter";
import { StatFigure } from "@/modules/reports/components/stat-card";
import { parseRange } from "@/modules/reports/ranges";

const copy = messages.finance.entries;

const first = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? "";

type SearchParams = {
  rango?: string;
  desde?: string;
  hasta?: string;
  tipo?: string;
  categoria?: string;
  pago?: string;
  anulados?: string;
};

export default async function FinanceEntriesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { user } = await requirePageCapability("finance.view");
  const raw = await searchParams;
  const range = parseRange({
    rango: first(raw.rango),
    desde: first(raw.desde),
    hasta: first(raw.hasta),
  });
  const type = (FINANCE_ENTRY_TYPES as readonly string[]).includes(first(raw.tipo))
    ? (first(raw.tipo) as (typeof FINANCE_ENTRY_TYPES)[number])
    : undefined;
  const paidWith = (ALL_PAYMENT_METHODS as readonly string[]).includes(first(raw.pago))
    ? (first(raw.pago) as (typeof ALL_PAYMENT_METHODS)[number])
    : undefined;
  const categoryId = first(raw.categoria) || undefined;
  const includeVoided = first(raw.anulados) === "1";

  const [categories, suppliers, entries] = await Promise.all([
    listFinanceCategories({ includeArchived: true }),
    listSupplierOptions(),
    listFinanceEntries({ range, type, categoryId, paidWith, includeVoided }),
  ]);
  const canWrite = hasCapability(user.role, "finance.write");
  const canVoid = hasCapability(user.role, "finance.void");
  const active = (kind: "EXPENSE" | "INCOME") =>
    categories.filter((category) => category.type === kind && !category.archived);

  const kept: Record<string, string> = {};
  if (type) kept.tipo = type;
  if (categoryId) kept.categoria = categoryId;
  if (paidWith) kept.pago = paidWith;
  if (includeVoided) kept.anulados = "1";

  const { totals } = entries;

  return (
    <div className="space-y-6">
      <PageHeader
        title={copy.title}
        description={copy.description}
        actions={
          canWrite ? (
            <>
              <NewEntryButton type="EXPENSE" categories={active("EXPENSE")} suppliers={suppliers} />
              <NewEntryButton type="INCOME" categories={active("INCOME")} suppliers={suppliers} />
            </>
          ) : undefined
        }
      />

      <RangeFilter path="/finanzas/movimientos" range={range} params={kept} />
      <EntryFilters
        path="/finanzas/movimientos"
        range={range}
        categories={categories}
        selected={{
          type: type ?? "",
          category: categoryId ?? "",
          payment: paidWith ?? "",
          voided: includeVoided,
        }}
      />

      <FinanceExportLinks
        kind="movimientos"
        params={{
          ...(range.preset
            ? { rango: range.preset }
            : { desde: range.fromKey, hasta: range.toKey }),
          ...kept,
        }}
      />

      <div className="border-divider grid gap-6 border-y py-5 sm:grid-cols-3">
        <StatFigure label={copy.totals.expenses} value={formatMoney(totals.expenseCents)} />
        <StatFigure label={copy.totals.income} value={formatMoney(totals.incomeCents)} />
        <StatFigure
          label={copy.totals.balance}
          value={formatMoney(totals.incomeCents - totals.expenseCents)}
          tone={totals.incomeCents - totals.expenseCents >= 0 ? "good" : "bad"}
        />
      </div>

      {entries.rows.length === 0 ? (
        <EmptyState title={copy.empty} description={copy.emptyHint} />
      ) : (
        <>
          <div className="bg-card overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{copy.columns.date}</TableHead>
                  <TableHead>{copy.columns.category}</TableHead>
                  <TableHead>{copy.columns.description}</TableHead>
                  <TableHead>{copy.columns.payment}</TableHead>
                  <TableHead className="text-right">{copy.columns.amount}</TableHead>
                  {canVoid ? (
                    <TableHead>
                      <span className="sr-only">{copy.columns.actions}</span>
                    </TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.rows.map((row) => {
                  const voided = row.voidedAt !== null;
                  const sign = row.type === "INCOME" ? "+" : "−";
                  const summary = `${row.categoryName}, ${formatMoney(row.amountCents)}`;
                  return (
                    <TableRow key={row.id} className={cn(voided && "text-muted-foreground")}>
                      <TableCell className="tabular-nums">
                        {formatLocalDate(row.occurredAt)}
                      </TableCell>
                      <TableCell>{row.categoryName}</TableCell>
                      <TableCell className="max-w-md whitespace-normal">
                        <span className={cn(voided && "line-through")}>{row.description}</span>
                        {row.supplierName ? (
                          <span className="text-muted-foreground"> · {row.supplierName}</span>
                        ) : null}
                        <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
                          {row.fromDrawer ? (
                            <span className="bg-secondary text-secondary-foreground rounded-full px-2 py-0.5 text-xs">
                              {copy.badges.drawer}
                            </span>
                          ) : null}
                          {row.fixedCostName ? (
                            <span className="bg-secondary text-secondary-foreground rounded-full px-2 py-0.5 text-xs">
                              {copy.badges.fixedCost} {row.period}
                            </span>
                          ) : null}
                          {voided ? (
                            <span className="bg-destructive/10 text-destructive rounded-full px-2 py-0.5 text-xs">
                              {copy.badges.voided}
                            </span>
                          ) : null}
                        </span>
                        {voided ? (
                          <span className="text-muted-foreground block text-xs">
                            {copy.voidedBy} {row.voidedByName}: {row.voidReason}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>{messages.finance.payments[row.paidWith]}</TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-medium tabular-nums",
                          !voided && row.type === "INCOME" && "text-success",
                          voided && "line-through",
                        )}
                      >
                        {sign} {formatMoney(row.amountCents)}
                      </TableCell>
                      {canVoid ? (
                        <TableCell className="text-right">
                          {!voided && !row.fromDrawer ? (
                            <VoidEntryButton entryId={row.id} summary={summary} />
                          ) : null}
                        </TableCell>
                      ) : null}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {entries.truncated ? (
            <p className="text-muted-foreground text-sm">{copy.truncated}</p>
          ) : null}
        </>
      )}
    </div>
  );
}
