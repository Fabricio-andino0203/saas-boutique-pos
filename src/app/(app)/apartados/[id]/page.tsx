import Link from "next/link";
import { notFound } from "next/navigation";

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
import { Notice } from "@/components/shared/notice";
import { messages } from "@/config/messages.es";
import { requirePageCapability } from "@/lib/auth";
import { formatLocalDateTime } from "@/lib/dates";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import { hasCapability } from "@/lib/permissions";
import { getSetting } from "@/lib/settings";
import { LayawayActions } from "@/modules/layaways/components/layaway-actions";
import { getLayawayDetail } from "@/modules/layaways/queries";

const copy = messages.layaways;

export default async function LayawayPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requirePageCapability("layaway.manage");
  const { id } = await params;
  const layaway = await getLayawayDetail(id);
  if (!layaway) {
    notFound();
  }
  const enabledMethods = await getSetting(db, "payments.enabled");
  const active = layaway.status === "ACTIVE";
  const t = copy.detail;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title={`${t.title} ${layaway.number}`}
        description={`${copy.status[layaway.status]} · ${t.createdAt} ${formatLocalDateTime(layaway.createdAt)}`}
        actions={
          <Link href="/apartados" className={buttonVariants({ variant: "outline" })}>
            {t.back}
          </Link>
        }
      />

      <dl className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
        <div className="flex gap-2">
          <dt className="text-muted-foreground">{t.customer}:</dt>
          <dd className="font-medium">
            {hasCapability(user.role, "customer.view") ? (
              <Link
                href={`/clientes/${layaway.customerId}`}
                className="text-primary underline underline-offset-4"
              >
                {layaway.customerName}
              </Link>
            ) : (
              layaway.customerName
            )}
            {layaway.customerPhone ? ` · ${layaway.customerPhone}` : ""}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-foreground">{t.createdBy}:</dt>
          <dd className="font-medium">{layaway.createdByName}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-foreground">{t.expires}:</dt>
          <dd
            className={active && layaway.daysLeft <= 3 ? "text-warning font-medium" : "font-medium"}
          >
            {formatLocalDateTime(layaway.expiresAt)}
          </dd>
        </div>
        {layaway.sale ? (
          <div className="flex gap-2">
            <dt className="text-muted-foreground">{t.saleNumber}:</dt>
            <dd className="font-medium">
              <Link
                href={`/ventas/${layaway.sale.id}`}
                className="text-primary underline underline-offset-4"
              >
                {layaway.sale.number}
              </Link>
            </dd>
          </div>
        ) : null}
      </dl>

      {active && layaway.daysLeft < 0 ? <Notice tone="warning">{t.overdue}</Notice> : null}
      {layaway.cancel ? (
        <section role="status" className="bg-muted space-y-1 rounded-lg border p-4 text-sm">
          <p className="font-semibold">{copy.status[layaway.status]}</p>
          <p>
            {t.cancelledOn} {formatLocalDateTime(layaway.cancel.at)}
            {layaway.cancel.byName ? ` · ${layaway.cancel.byName}` : ""}
          </p>
          <p>
            {t.reason}: {layaway.cancel.reason}
          </p>
          {layaway.cancel.retainedCents > 0 ? (
            <p>
              {t.retained} {formatMoney(layaway.cancel.retainedCents)}
            </p>
          ) : null}
        </section>
      ) : null}

      <div
        role="group"
        aria-label={t.summary.balance}
        className="bg-muted grid gap-2 rounded-lg px-4 py-3 sm:grid-cols-3"
      >
        <p>
          <span className="text-muted-foreground block text-sm">{t.summary.total}</span>
          <span className="text-xl font-semibold tabular-nums">
            {formatMoney(layaway.totalCents)}
          </span>
        </p>
        <p>
          <span className="text-muted-foreground block text-sm">{t.summary.paid}</span>
          <span className="text-xl font-semibold tabular-nums">
            {formatMoney(layaway.paidCents)}
          </span>
        </p>
        <p>
          <span className="text-muted-foreground block text-sm">{t.summary.balance}</span>
          <span className="text-3xl font-bold tabular-nums">
            {formatMoney(active ? layaway.balanceCents : 0)}
          </span>
        </p>
      </div>

      <section aria-labelledby="layaway-items" className="space-y-2">
        <h2 id="layaway-items" className="text-lg font-medium">
          {t.items.title}
        </h2>
        <Table>
          <TableCaption className="sr-only">{t.items.title}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{t.items.product}</TableHead>
              <TableHead className="text-right">{t.items.quantity}</TableHead>
              <TableHead className="text-right">{t.items.price}</TableHead>
              <TableHead className="text-right">{t.items.total}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {layaway.items.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  {item.productName}
                  <span className="text-muted-foreground block text-xs">
                    {[item.sizeName, item.colorName].filter(Boolean).join(" · ")}
                    {item.sizeName || item.colorName ? " · " : ""}
                    {item.sku}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">{item.quantity}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(item.unitPriceCents)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(item.unitPriceCents * item.quantity)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <section aria-labelledby="layaway-payments" className="space-y-2">
        <h2 id="layaway-payments" className="text-lg font-medium">
          {t.payments.title}
        </h2>
        <Table>
          <TableCaption className="sr-only">{t.payments.title}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{t.payments.receipt}</TableHead>
              <TableHead>{t.payments.date}</TableHead>
              <TableHead>{t.payments.method}</TableHead>
              <TableHead>{t.payments.by}</TableHead>
              <TableHead className="text-right">{t.payments.amount}</TableHead>
              <TableHead>
                <span className="sr-only">{t.payments.print}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {layaway.payments.map((payment) => (
              <TableRow key={payment.id}>
                <TableCell>{payment.receiptNumber}</TableCell>
                <TableCell>{formatLocalDateTime(payment.createdAt)}</TableCell>
                <TableCell>
                  {messages.cash.methods[payment.method]}
                  {payment.reference ? ` · ${payment.reference}` : ""}
                </TableCell>
                <TableCell>{payment.userName}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(payment.amountCents)}
                </TableCell>
                <TableCell>
                  <a
                    href={`/imprimir/apartado/${payment.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline underline-offset-4"
                    aria-label={`${t.payments.print} ${payment.receiptNumber}`}
                  >
                    {t.payments.print}
                  </a>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      {active ? (
        <LayawayActions
          layawayId={layaway.id}
          number={layaway.number}
          balanceCents={layaway.balanceCents}
          enabledMethods={enabledMethods}
          cancelNeedsManager={!hasCapability(user.role, "layaway.cancel")}
          canSettle={hasCapability(user.role, "sale.create")}
        />
      ) : null}
    </div>
  );
}
