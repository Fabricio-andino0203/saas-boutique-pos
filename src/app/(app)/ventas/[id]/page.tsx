import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shared/page-header";
import { buttonVariants } from "@/components/ui/button";
import { messages } from "@/config/messages.es";
import { requirePageCapability } from "@/lib/auth";
import { formatLocalDateTime } from "@/lib/dates";
import { formatMoney, formatPercentBps } from "@/lib/format";
import { hasCapability } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { VoidSaleDialog } from "@/modules/sales/components/void-sale-dialog";
import { listReturnsOfSale } from "@/modules/returns/queries";
import { getSaleDocument } from "@/modules/sales/queries";

const copy = messages.salesHistory.detail;

export default async function SaleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requirePageCapability("sale.create");
  const { id } = await params;
  const doc = await getSaleDocument(id);
  // Un cajero solo ve sus ventas; las de otros "no existen" para esa persona.
  if (!doc || (doc.sellerId !== user.id && !hasCapability(user.role, "cash.viewOthers"))) {
    notFound();
  }
  const voided = doc.status === "VOIDED";
  const returns = await listReturnsOfSale(doc.id);
  const rate = doc.items.find((item) => item.taxRate > 0)?.taxRate ?? 0;
  const methods = messages.pos.charge.methods;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title={`${copy.title} ${doc.number}`}
        description={formatLocalDateTime(doc.createdAt)}
        actions={
          <>
            <Link href="/ventas" className={buttonVariants({ variant: "outline" })}>
              {copy.back}
            </Link>
            <a
              href={`/imprimir/ticket/${doc.id}?auto=1`}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: "outline" })}
            >
              {copy.reprint}
            </a>
            {doc.invoice ? (
              <a
                href={`/imprimir/factura/${doc.id}?auto=1`}
                target="_blank"
                rel="noreferrer"
                className={buttonVariants({ variant: "outline" })}
              >
                {copy.printInvoice}
              </a>
            ) : null}
          </>
        }
      />

      {returns.length > 0 ? (
        <section aria-labelledby="sale-returns" className="space-y-2">
          <h2 id="sale-returns" className="text-lg font-medium">
            {messages.returns.detail.title}
          </h2>
          <ul className="divide-y rounded-lg border text-sm">
            {returns.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <span>
                  <span className="font-medium">{entry.number}</span> ·{" "}
                  {formatLocalDateTime(entry.createdAt)} · {entry.units}{" "}
                  {messages.returns.detail.units} · {messages.returns.methods[entry.refundMethod]}
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-semibold tabular-nums">
                    {formatMoney(entry.refundCents)}
                  </span>
                  <a
                    href={`/imprimir/devolucion/${entry.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline underline-offset-4"
                  >
                    {messages.returns.detail.view}
                  </a>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!voided && hasCapability(user.role, "return.create") ? (
        <Link
          href={`/devoluciones?venta=${doc.id}`}
          className={buttonVariants({ variant: "outline" })}
        >
          {messages.returns.detail.action}
        </Link>
      ) : null}

      {voided ? (
        <section
          role="status"
          className="bg-destructive/10 space-y-1 rounded-lg border p-4 text-sm"
        >
          <p className="text-destructive font-semibold">{copy.voidedTitle}</p>
          {doc.voided ? (
            <p>
              {formatLocalDateTime(doc.voided.at)}
              {doc.voided.reason ? ` · ${doc.voided.reason}` : ""}
            </p>
          ) : null}
        </section>
      ) : returns.length > 0 ? (
        <p className="text-muted-foreground text-sm">{copy.hasReturns}</p>
      ) : doc.shiftOpen ? (
        <VoidSaleDialog
          saleId={doc.id}
          number={doc.number}
          needsManager={!hasCapability(user.role, "sale.void")}
        />
      ) : (
        <p className="text-muted-foreground text-sm">{copy.closedShift}</p>
      )}

      <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
        <div className="flex gap-2">
          <dt className="text-muted-foreground">{copy.seller}:</dt>
          <dd className="font-medium">{doc.sellerName}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-foreground">{copy.customer}:</dt>
          <dd className="font-medium">
            {doc.customer?.name ?? doc.invoice?.customerName ?? messages.salesHistory.finalConsumer}
          </dd>
        </div>
        {doc.invoice ? (
          <div className="flex gap-2">
            <dt className="text-muted-foreground">{copy.invoice}:</dt>
            <dd className="font-medium tabular-nums">{doc.invoice.number}</dd>
          </div>
        ) : null}
        <div className="flex gap-2">
          <dt className="text-muted-foreground">{messages.salesHistory.columns.status}:</dt>
          <dd className={cn("font-medium", voided ? "text-destructive" : "text-success")}>
            {messages.salesHistory.status[doc.status]}
          </dd>
        </div>
      </dl>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{copy.lines}</caption>
          <thead>
            <tr className="text-muted-foreground border-b text-left">
              <th className="py-1.5 pr-3 font-medium">{copy.columns.quantity}</th>
              <th className="py-1.5 pr-3 font-medium">{copy.columns.description}</th>
              <th className="py-1.5 pr-3 text-right font-medium">{copy.columns.price}</th>
              <th className="py-1.5 pr-3 text-right font-medium">{copy.columns.discount}</th>
              <th className="py-1.5 text-right font-medium">{copy.columns.total}</th>
            </tr>
          </thead>
          <tbody>
            {doc.items.map((item) => (
              <tr key={item.id} className="border-b align-top last:border-0">
                <td className="py-1.5 pr-3 tabular-nums">{item.quantity}</td>
                <td className="py-1.5 pr-3">
                  {item.productName}
                  <span className="text-muted-foreground block text-xs">
                    {[item.sizeName, item.colorName].filter(Boolean).join(" · ")}
                    {item.sku ? ` · ${item.sku}` : ""}
                  </span>
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums">
                  {formatMoney(item.unitPriceCents)}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums">
                  {item.lineDiscountCents > 0 ? `−${formatMoney(item.lineDiscountCents)}` : ""}
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  {formatMoney(item.lineTotalCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <section aria-labelledby="sale-payments" className="space-y-2">
          <h2 id="sale-payments" className="text-lg font-medium">
            {copy.payments}
          </h2>
          <dl className="space-y-1 text-sm">
            {doc.payments.map((payment, index) => (
              <div key={index} className="flex justify-between gap-4">
                <dt>
                  {methods[payment.method as keyof typeof methods] ?? payment.method}
                  {payment.reference ? ` · ${payment.reference}` : ""}
                </dt>
                <dd className="tabular-nums">{formatMoney(payment.amountCents)}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-4 border-t pt-1">
              <dt>{copy.received}</dt>
              <dd className="tabular-nums">{formatMoney(doc.paidCents)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>{copy.change}</dt>
              <dd className="tabular-nums">{formatMoney(doc.changeCents)}</dd>
            </div>
          </dl>
        </section>
        <section aria-labelledby="sale-totals" className="space-y-2">
          <h2 id="sale-totals" className="text-lg font-medium">
            {copy.totals}
          </h2>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between gap-4">
              <dt>{copy.subtotal}</dt>
              <dd className="tabular-nums">{formatMoney(doc.grossCents)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>{copy.discount}</dt>
              <dd className="tabular-nums">
                {doc.discountCents > 0 ? `−${formatMoney(doc.discountCents)}` : formatMoney(0)}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>
                {doc.taxIncluded ? copy.taxIncluded : copy.taxAdded}
                {rate > 0 ? ` (${formatPercentBps(rate)} %)` : ""}
              </dt>
              <dd className="tabular-nums">{formatMoney(doc.taxCents)}</dd>
            </div>
            <div className="flex justify-between gap-4 border-t pt-1 text-base font-semibold">
              <dt>{copy.total}</dt>
              <dd className="tabular-nums">{formatMoney(doc.totalCents)}</dd>
            </div>
          </dl>
        </section>
      </div>
    </div>
  );
}
