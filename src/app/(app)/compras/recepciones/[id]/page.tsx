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
import { Notice } from "@/components/shared/notice";
import { messages } from "@/config/messages.es";
import { requirePageCapability } from "@/lib/auth";
import { formatLocalDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { mulCents } from "@/lib/money";
import { hasCapability } from "@/lib/permissions";
import { getReceipt } from "@/modules/purchasing/queries";

export default async function ReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ recibida?: string }>;
}) {
  const { user } = await requirePageCapability("purchase.receive");
  const { id } = await params;
  const justReceived = (await searchParams).recibida === "1";
  const showCost = hasCapability(user.role, "product.viewCost");
  const receipt = await getReceipt(id, { includeCost: showCost });
  if (!receipt) {
    notFound();
  }
  const copy = messages.purchasing;
  const heads = copy.columns;

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div className="space-y-4">
        <Link href="/compras/recepciones" className="text-muted-foreground text-sm hover:underline">
          {copy.backToReceipts}
        </Link>
        <PageHeader
          title={`${copy.receipt.detailTitle} ${receipt.number}`}
          description={`${receipt.supplierName} · ${formatLocalDateTime(receipt.receivedAt)} · ${receipt.receivedByName}`}
        />
        {justReceived ? <Notice tone="success">{copy.receipt.created}</Notice> : null}
        <p className="text-sm">
          {receipt.supplierInvoiceRef ? (
            <span>
              {heads.invoice}: {receipt.supplierInvoiceRef}.{" "}
            </span>
          ) : null}
          {receipt.order ? (
            <span>
              {heads.order}:{" "}
              <Link
                href={`/compras/${receipt.order.id}`}
                className="text-primary underline underline-offset-4"
              >
                {receipt.order.number}
              </Link>
              .{" "}
            </span>
          ) : null}
          <Link
            href={`/compras/recepciones?proveedor=${receipt.supplierId}`}
            className="text-primary underline underline-offset-4"
          >
            {copy.receipt.supplierHistory}
          </Link>
          {" · "}
          <Link
            href={`/inventario/etiquetas?recepcion=${receipt.id}`}
            className="text-primary underline underline-offset-4"
          >
            {messages.labels.fromReceipt}
          </Link>
        </p>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableCaption className="sr-only">{copy.receipt.detailTitle}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{heads.product}</TableHead>
              <TableHead>{heads.sku}</TableHead>
              <TableHead className="text-right">{heads.quantity}</TableHead>
              {showCost ? <TableHead className="text-right">{heads.cost}</TableHead> : null}
              {showCost ? <TableHead className="text-right">{heads.lineTotal}</TableHead> : null}
              <TableHead>{copy.receipt.kardex}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {receipt.lines.map((line) => (
              <TableRow key={line.variantId}>
                <TableCell>{[line.productName, line.label].filter(Boolean).join(" · ")}</TableCell>
                <TableCell className="font-mono text-xs">{line.sku}</TableCell>
                <TableCell className="text-right tabular-nums">{line.quantity}</TableCell>
                {showCost ? (
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(line.unitCostCents ?? 0)}
                  </TableCell>
                ) : null}
                {showCost ? (
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(mulCents(line.unitCostCents ?? 0, line.quantity))}
                  </TableCell>
                ) : null}
                <TableCell>
                  <Link
                    href={`/inventario/kardex/${line.variantId}`}
                    className="text-primary underline underline-offset-4"
                  >
                    {copy.receipt.kardex}
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-right font-medium">
        <span className="tabular-nums">{receipt.units}</span> {copy.receipt.units}
        {receipt.totalCostCents !== null ? (
          <>
            {" · "}
            {copy.receipt.total}:{" "}
            <span className="tabular-nums">{formatMoney(receipt.totalCostCents)}</span>
          </>
        ) : null}
      </p>
    </div>
  );
}
