import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { buttonVariants } from "@/components/ui/button";
import { messages } from "@/config/messages.es";
import { requirePageCapability } from "@/lib/auth";
import { formatLocalDateTime } from "@/lib/dates";
import { currentEntitlements } from "@/lib/entitlements";
import { formatMoney } from "@/lib/format";
import { includesFeature } from "@/lib/tenancy/billing";
import { CashMovementForm } from "@/modules/cash/components/cash-movement-form";
import { CloseCashForm } from "@/modules/cash/components/close-cash-form";
import { OpenCashForm } from "@/modules/cash/components/open-cash-form";
import { getCashSessionDetail, getOpenSessionOf, getTerminalStatus } from "@/modules/cash/queries";
import { listFinanceCategories } from "@/modules/finance/queries";

export default async function CashPage() {
  const { user } = await requirePageCapability("cash.open");
  const copy = messages.cash;
  const open = await getOpenSessionOf(user.id);

  if (!open) {
    const terminal = await getTerminalStatus();
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader
          title={copy.title}
          description={copy.description}
          actions={
            <Link href="/caja/cierres" className={buttonVariants({ variant: "outline" })}>
              {messages.nav.cashClosings}
            </Link>
          }
        />
        {terminal.openBy ? (
          <div role="status" className="bg-muted/50 space-y-1 rounded-lg border p-4 text-sm">
            <p className="font-medium">
              {terminal.terminalName} {copy.open.busyBy} {terminal.openBy}.
            </p>
            <p className="text-muted-foreground">{copy.open.busyHint}</p>
          </div>
        ) : (
          <OpenCashForm terminalName={terminal.terminalName} />
        )}
      </div>
    );
  }

  const detail = await getCashSessionDetail(open.id);
  // Con el módulo Finanzas en el plan, las salidas y entradas se pueden registrar como gasto o ingreso, con su categoría.
  const financeCategories = includesFeature(await currentEntitlements(), "finance")
    ? await listFinanceCategories()
    : null;
  if (!detail) {
    return null;
  }
  const { totals, sales } = detail;
  const cards = [
    { label: copy.current.float, value: formatMoney(totals.openingFloatCents) },
    { label: copy.current.cashSales, value: formatMoney(totals.cashPaymentsCents) },
    { label: copy.current.layawayCash, value: formatMoney(totals.layawayCashCents) },
    { label: copy.current.change, value: formatMoney(totals.changeGivenCents) },
    { label: copy.current.movementsIn, value: formatMoney(totals.movementsInCents) },
    { label: copy.current.movementsOut, value: formatMoney(totals.movementsOutCents) },
    { label: copy.current.cashRefunds, value: formatMoney(totals.cashRefundsCents) },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title={copy.title}
        description={`${open.terminalName} · ${copy.current.openedAt} ${formatLocalDateTime(open.openedAt)}`}
        actions={
          <Link href="/caja/cierres" className={buttonVariants({ variant: "outline" })}>
            {messages.nav.cashClosings}
          </Link>
        }
      />

      <section aria-labelledby="turn-title" className="bg-card space-y-4 rounded-lg border p-4">
        <h2 id="turn-title" className="text-lg font-medium">
          {copy.current.title}
        </h2>
        <div role="group" aria-label={copy.current.expected} className="bg-muted/50 rounded-lg p-4">
          <p className="text-muted-foreground text-sm">{copy.current.expected}</p>
          <p className="text-3xl font-semibold tabular-nums">{formatMoney(detail.expectedCents)}</p>
          <p className="text-muted-foreground text-xs">{copy.current.expectedHint}</p>
        </div>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {cards.map((card) => (
            <div key={card.label} className="space-y-0.5">
              <dt className="text-muted-foreground text-xs">{card.label}</dt>
              <dd className="font-medium tabular-nums">{card.value}</dd>
            </div>
          ))}
        </dl>
        <p className="text-muted-foreground text-sm">
          {sales.count === 0
            ? copy.current.noSales
            : `${copy.current.sales}: ${sales.count} · ${formatMoney(sales.totalCents)}`}
        </p>
      </section>

      <CashMovementForm financeCategories={financeCategories} />

      {detail.movements.length > 0 ? (
        <section aria-labelledby="turn-movements" className="space-y-2">
          <h2 id="turn-movements" className="text-lg font-medium">
            {copy.movements.listTitle}
          </h2>
          <ul className="divide-y rounded-lg border text-sm">
            {detail.movements.map((movement) => (
              <li key={movement.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3">
                <span className="text-muted-foreground">
                  {formatLocalDateTime(movement.createdAt)}
                </span>
                <span className="font-medium">{copy.movements[movement.type]}</span>
                <span className="tabular-nums">{formatMoney(movement.amountCents)}</span>
                <span className="text-muted-foreground">{movement.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <CloseCashForm />
    </div>
  );
}
