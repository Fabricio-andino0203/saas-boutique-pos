import Link from "next/link";
import { notFound } from "next/navigation";

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
import { formatMoney } from "@/lib/format";
import { hasCapability } from "@/lib/permissions";
import { AdjustCreditForm } from "@/modules/customers/components/adjust-credit-form";
import { getCustomerFicha } from "@/modules/customers/queries";
import { listCustomerLayaways } from "@/modules/layaways/queries";

const copy = messages.customers;

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requirePageCapability("customer.view");
  const { id } = await params;
  const customer = await getCustomerFicha(id);
  if (!customer) {
    notFound();
  }
  const canAdjust = hasCapability(user.role, "credit.adjust");
  const layaways = hasCapability(user.role, "layaway.manage")
    ? await listCustomerLayaways(customer.id)
    : null;
  const details = [
    [copy.fields.phone, customer.phone],
    [copy.fields.email, customer.email],
    [copy.fields.taxId, customer.taxId],
    [copy.fields.notes, customer.notes],
  ] as const;

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <PageHeader
        title={customer.name}
        description={`${copy.since} ${formatLocalDateTime(customer.createdAt)}${customer.archived ? ` · ${copy.archived}` : ""}`}
      />

      <dl className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
        {details.map(([label, value]) =>
          value ? (
            <div key={label} className="flex gap-2">
              <dt className="text-muted-foreground">{label}:</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ) : null,
        )}
      </dl>

      <section aria-labelledby="credit-title" className="space-y-4">
        <h2 id="credit-title" className="text-lg font-medium">
          {copy.credit.title}
        </h2>
        <div
          role="group"
          aria-label={copy.credit.balance}
          className="bg-muted flex flex-wrap items-baseline justify-between gap-2 rounded-lg px-4 py-3"
        >
          <span className="text-muted-foreground">{copy.credit.balance}</span>
          <span className="text-3xl font-bold tabular-nums">
            {formatMoney(customer.storeCreditCents)}
          </span>
        </div>
        {canAdjust ? <AdjustCreditForm customerId={customer.id} /> : null}

        {customer.movements.length === 0 ? (
          <p className="text-muted-foreground text-sm">{copy.credit.empty}</p>
        ) : (
          <Table>
            <TableCaption className="sr-only">{copy.credit.movements}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>{copy.credit.columns.date}</TableHead>
                <TableHead>{copy.credit.columns.movement}</TableHead>
                <TableHead>{copy.credit.columns.document}</TableHead>
                <TableHead>{copy.credit.columns.note}</TableHead>
                <TableHead>{copy.credit.columns.user}</TableHead>
                <TableHead className="text-right">{copy.credit.columns.amount}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customer.movements.map((movement) => (
                <TableRow key={movement.id}>
                  <TableCell>{formatLocalDateTime(movement.createdAt)}</TableCell>
                  <TableCell>{copy.credit.reasons[movement.reason]}</TableCell>
                  <TableCell>
                    {movement.document ? (
                      <Link
                        href={movement.document.href}
                        className="text-primary underline underline-offset-4"
                      >
                        {movement.document.label}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>{movement.note ?? "—"}</TableCell>
                  <TableCell>{movement.userName}</TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${movement.amountCents < 0 ? "text-destructive" : "text-success"}`}
                  >
                    {movement.amountCents > 0 ? "+" : "−"}
                    {formatMoney(Math.abs(movement.amountCents))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <section aria-labelledby="sales-title" className="space-y-2">
        <h2 id="sales-title" className="text-lg font-medium">
          {copy.sales.title}
        </h2>
        {customer.sales.length === 0 ? (
          <p className="text-muted-foreground text-sm">{copy.sales.empty}</p>
        ) : (
          <ul className="divide-y rounded-lg border text-sm">
            {customer.sales.map((sale) => (
              <li key={sale.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <span>
                  <Link
                    href={`/ventas/${sale.id}`}
                    className="text-primary font-medium underline underline-offset-4"
                  >
                    {sale.number}
                  </Link>{" "}
                  · {formatLocalDateTime(sale.createdAt)}
                  {sale.voided ? ` · ${copy.sales.voided}` : ""}
                </span>
                <span className="font-semibold tabular-nums">{formatMoney(sale.totalCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {layaways ? (
        <section aria-labelledby="layaways-title" className="space-y-2">
          <h2 id="layaways-title" className="text-lg font-medium">
            {copy.layaways.title}
          </h2>
          {layaways.length === 0 ? (
            <p className="text-muted-foreground text-sm">{copy.layaways.empty}</p>
          ) : (
            <ul className="divide-y rounded-lg border text-sm">
              {layaways.map((layaway) => (
                <li
                  key={layaway.id}
                  className="flex flex-wrap items-center justify-between gap-2 p-3"
                >
                  <span>
                    <Link
                      href={`/apartados/${layaway.id}`}
                      className="text-primary font-medium underline underline-offset-4"
                    >
                      {layaway.number}
                    </Link>{" "}
                    · {messages.layaways.status[layaway.status]}
                  </span>
                  <span className="tabular-nums">
                    {formatMoney(layaway.paidCents)} / {formatMoney(layaway.totalCents)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section aria-labelledby="returns-title" className="space-y-2">
        <h2 id="returns-title" className="text-lg font-medium">
          {copy.returns.title}
        </h2>
        {customer.returns.length === 0 ? (
          <p className="text-muted-foreground text-sm">{copy.returns.empty}</p>
        ) : (
          <ul className="divide-y rounded-lg border text-sm">
            {customer.returns.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <span>
                  <a
                    href={`/imprimir/devolucion/${entry.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary font-medium underline underline-offset-4"
                  >
                    {entry.number}
                  </a>{" "}
                  · {formatLocalDateTime(entry.createdAt)} ·{" "}
                  {entry.type === "EXCHANGE" ? copy.returns.exchange : copy.returns.return} ·{" "}
                  {messages.returns.methods[entry.refundMethod]}
                </span>
                <span className="font-semibold tabular-nums">{formatMoney(entry.refundCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
