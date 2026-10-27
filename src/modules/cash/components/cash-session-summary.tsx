import { messages } from "@/config/messages.es";
import { formatLocalDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CashStatusBadge } from "@/modules/cash/components/cash-status-badge";
import { DENOMINATIONS_CENTS } from "@/modules/cash/schemas";
import type { CashSessionDetail } from "@/modules/cash/queries";

const copy = messages.cash.detail;

function Row({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: "ok" | "bad";
}) {
  return (
    <>
      <dt className={cn(strong && "font-medium")}>{label}</dt>
      <dd
        className={cn(
          "text-right tabular-nums",
          strong && "font-semibold",
          tone === "ok" && "text-success",
          tone === "bad" && "text-destructive",
        )}
      >
        {value}
      </dd>
    </>
  );
}

/** El resumen de un turno de caja: el mismo para la pantalla y para la hoja que se imprime. */
export function CashSessionSummary({ detail }: { detail: CashSessionDetail }) {
  const { session, totals, movements, payments, sales, denominations } = detail;
  const closed = session.status !== "OPEN";
  const difference = session.differenceCents;

  return (
    <div className="space-y-6">
      <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
        <div className="flex gap-2">
          <dt className="text-muted-foreground">{copy.cashier}:</dt>
          <dd className="font-medium">{session.userName}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-foreground">{copy.terminal}:</dt>
          <dd className="font-medium">{session.terminalName}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-foreground">{copy.opened}:</dt>
          <dd className="font-medium">{formatLocalDateTime(session.openedAt)}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-foreground">{copy.closed}:</dt>
          <dd className="font-medium">
            {session.closedAt ? formatLocalDateTime(session.closedAt) : "—"}
          </dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="text-muted-foreground">{messages.cash.list.columns.status}:</dt>
          <dd>
            <CashStatusBadge status={session.status} />
          </dd>
        </div>
        {session.approvedByName ? (
          <div className="flex gap-2">
            <dt className="text-muted-foreground">{copy.approvedBy}:</dt>
            <dd className="font-medium">{session.approvedByName}</dd>
          </div>
        ) : null}
      </dl>

      <section aria-labelledby="summary-title" className="space-y-2">
        <h2 id="summary-title" className="text-lg font-medium">
          {copy.summary}
        </h2>
        <dl className="grid max-w-md grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
          <Row label={copy.float} value={formatMoney(totals.openingFloatCents)} />
          <Row label={`+ ${copy.cashPayments}`} value={formatMoney(totals.cashPaymentsCents)} />
          <Row label={`− ${copy.change}`} value={formatMoney(totals.changeGivenCents)} />
          <Row label={`+ ${copy.movementsIn}`} value={formatMoney(totals.movementsInCents)} />
          <Row label={`− ${copy.movementsOut}`} value={formatMoney(totals.movementsOutCents)} />
          <Row label={copy.expected} value={formatMoney(detail.expectedCents)} strong />
          {closed && session.countedCashCents !== null ? (
            <Row label={copy.counted} value={formatMoney(session.countedCashCents)} strong />
          ) : null}
          {closed && difference !== null ? (
            <Row
              label={copy.difference}
              value={formatMoney(difference)}
              strong
              tone={difference === 0 ? "ok" : "bad"}
            />
          ) : null}
        </dl>
        <p className="text-muted-foreground text-sm">
          {copy.salesCount}: <span className="tabular-nums">{sales.count}</span> · {copy.salesTotal}
          : <span className="tabular-nums">{formatMoney(sales.totalCents)}</span> · {copy.voided}:{" "}
          <span className="tabular-nums">{sales.voidedCount}</span>
        </p>
      </section>

      <section aria-labelledby="payments-title" className="space-y-2">
        <h2 id="payments-title" className="text-lg font-medium">
          {copy.paymentsTitle}
        </h2>
        {payments.length === 0 ? (
          <p className="text-muted-foreground text-sm">{copy.noPayments}</p>
        ) : (
          <dl className="grid max-w-md grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
            {payments.map((payment) => (
              <Row
                key={payment.method}
                label={`${messages.cash.methods[payment.method]} (${payment.count})`}
                value={formatMoney(payment.amountCents)}
              />
            ))}
          </dl>
        )}
      </section>

      <section aria-labelledby="movements-title" className="space-y-2">
        <h2 id="movements-title" className="text-lg font-medium">
          {messages.cash.movements.title}
        </h2>
        {movements.length === 0 ? (
          <p className="text-muted-foreground text-sm">{messages.cash.movements.empty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">{messages.cash.movements.title}</caption>
              <thead>
                <tr className="text-muted-foreground border-b text-left">
                  <th className="py-1.5 pr-3 font-medium">
                    {messages.cash.movements.columns.time}
                  </th>
                  <th className="py-1.5 pr-3 font-medium">
                    {messages.cash.movements.columns.type}
                  </th>
                  <th className="py-1.5 pr-3 text-right font-medium">
                    {messages.cash.movements.columns.amount}
                  </th>
                  <th className="py-1.5 pr-3 font-medium">
                    {messages.cash.movements.columns.reason}
                  </th>
                  <th className="py-1.5 font-medium">{messages.cash.movements.columns.by}</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((movement) => (
                  <tr key={movement.id} className="border-b last:border-0">
                    <td className="py-1.5 pr-3">{formatLocalDateTime(movement.createdAt)}</td>
                    <td className="py-1.5 pr-3">{messages.cash.movements[movement.type]}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      {formatMoney(movement.amountCents)}
                    </td>
                    <td className="py-1.5 pr-3">{movement.reason}</td>
                    <td className="py-1.5">{movement.userName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {denominations ? (
        <section aria-labelledby="denominations-title" className="space-y-2">
          <h2 id="denominations-title" className="text-lg font-medium">
            {copy.denominationsTitle}
          </h2>
          <dl className="grid max-w-md grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
            {DENOMINATIONS_CENTS.filter((denomination) => denominations[denomination]).map(
              (denomination) => (
                <Row
                  key={denomination}
                  label={formatMoney(denomination)}
                  value={`× ${denominations[denomination]}`}
                />
              ),
            )}
          </dl>
        </section>
      ) : null}

      {closed ? (
        <section aria-labelledby="notes-title" className="space-y-1">
          <h2 id="notes-title" className="text-lg font-medium">
            {copy.notes}
          </h2>
          <p className="text-sm">{session.notes ?? copy.noNotes}</p>
        </section>
      ) : null}
    </div>
  );
}
