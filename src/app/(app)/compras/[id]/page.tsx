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
import { OrderActions } from "@/modules/purchasing/components/order-actions";
import { OrderStatusBadge } from "@/modules/purchasing/components/status-badge";
import { getPurchaseOrder } from "@/modules/purchasing/queries";

export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requirePageCapability("purchase.receive");
  const { id } = await params;
  const showCost = hasCapability(user.role, "product.viewCost");
  const order = await getPurchaseOrder(id, { includeCost: showCost });
  if (!order) {
    notFound();
  }
  const copy = messages.purchasing;
  const heads = copy.columns;

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div className="space-y-6">
        <Link href="/compras" className="text-muted-foreground text-sm hover:underline">
          {copy.back}
        </Link>
        <PageHeader
          title={order.number}
          description={`${order.supplierName} · ${formatLocalDateTime(order.createdAt)} · ${order.createdByName}`}
          actions={<OrderStatusBadge status={order.status} />}
        />
        {order.expectedAt ? (
          <p className="text-muted-foreground text-sm">
            {heads.expected}: {order.expectedAt}
          </p>
        ) : null}
        {order.notes ? <p className="text-sm">{order.notes}</p> : null}
        <OrderActions orderId={order.id} status={order.status} canOrder={showCost} />
      </div>

      <section aria-labelledby="order-lines" className="space-y-3">
        <h2 id="order-lines" className="text-lg font-medium">
          {copy.order.lines}
        </h2>
        <div className="overflow-x-auto">
          <Table>
            <TableCaption className="sr-only">{copy.order.lines}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>{heads.product}</TableHead>
                <TableHead>{heads.sku}</TableHead>
                <TableHead className="text-right">{heads.ordered}</TableHead>
                <TableHead className="text-right">{heads.received}</TableHead>
                <TableHead className="text-right">{heads.pending}</TableHead>
                {showCost ? <TableHead className="text-right">{heads.cost}</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {order.lines.map((line) => (
                <TableRow key={line.itemId}>
                  <TableCell>
                    {[line.productName, line.label].filter(Boolean).join(" · ")}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{line.sku}</TableCell>
                  <TableCell className="text-right tabular-nums">{line.orderedQty}</TableCell>
                  <TableCell className="text-right tabular-nums">{line.receivedQty}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {Math.max(0, line.orderedQty - line.receivedQty)}
                  </TableCell>
                  {showCost ? (
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(line.unitCostCents ?? 0)}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {order.totalCostCents !== null ? (
          <p className="text-right font-medium">
            {copy.order.total}:{" "}
            <span className="tabular-nums">{formatMoney(order.totalCostCents)}</span>
          </p>
        ) : null}
      </section>

      <section aria-labelledby="order-receipts" className="space-y-3">
        <h2 id="order-receipts" className="text-lg font-medium">
          {copy.order.receiptsTitle}
        </h2>
        {order.receipts.length === 0 ? (
          <p className="text-muted-foreground text-sm">{copy.order.noReceipts}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {order.receipts.map((receipt) => (
              <li key={receipt.id}>
                <Link
                  href={`/compras/recepciones/${receipt.id}`}
                  className="text-primary underline underline-offset-4"
                >
                  {receipt.number}
                </Link>{" "}
                · {formatLocalDateTime(receipt.receivedAt)} · {receipt.units} {copy.order.units}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
