import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shared/page-header";
import { messages } from "@/config/messages.es";
import { requirePageCapability } from "@/lib/auth";
import { hasCapability } from "@/lib/permissions";
import { ReceiptForm } from "@/modules/purchasing/components/receipt-form";
import { getPurchaseOrder, listSupplierOptions } from "@/modules/purchasing/queries";

export default async function NewReceiptPage({
  searchParams,
}: {
  searchParams: Promise<{ orden?: string }>;
}) {
  const { user } = await requirePageCapability("purchase.receive");
  const orderId = (await searchParams).orden;
  const canCaptureCost = hasCapability(user.role, "product.viewCost");
  const copy = messages.purchasing;

  let order;
  if (orderId) {
    const found = await getPurchaseOrder(orderId, { includeCost: canCaptureCost });
    if (!found || (found.status !== "ORDERED" && found.status !== "PARTIALLY_RECEIVED")) {
      notFound();
    }
    order = {
      id: found.id,
      number: found.number,
      supplierName: found.supplierName,
      lines: found.lines
        .filter((line) => line.orderedQty > line.receivedQty)
        .map((line) => ({
          variantId: line.variantId,
          productName: line.productName,
          label: line.label,
          sku: line.sku,
          quantity: line.orderedQty - line.receivedQty,
          pending: line.orderedQty - line.receivedQty,
          unitCostCents: line.unitCostCents ?? 0,
        })),
    };
  }
  const suppliers = order ? [] : await listSupplierOptions();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link href="/compras/recepciones" className="text-muted-foreground text-sm hover:underline">
        {copy.backToReceipts}
      </Link>
      <PageHeader title={copy.receipt.newTitle} description={copy.receipt.description} />
      <ReceiptForm suppliers={suppliers} canCaptureCost={canCaptureCost} order={order} />
    </div>
  );
}
