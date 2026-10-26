import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shared/page-header";
import { messages } from "@/config/messages.es";
import { requirePageCapability } from "@/lib/auth";
import { PurchaseOrderForm } from "@/modules/purchasing/components/purchase-order-form";
import { getPurchaseOrder, listSupplierOptions } from "@/modules/purchasing/queries";

export default async function EditPurchaseOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePageCapability("purchase.receive");
  await requirePageCapability("product.viewCost");
  const { id } = await params;
  const [order, suppliers] = await Promise.all([
    getPurchaseOrder(id, { includeCost: true }),
    listSupplierOptions(),
  ]);
  if (!order || order.status !== "DRAFT") {
    notFound();
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link href={`/compras/${id}`} className="text-muted-foreground text-sm hover:underline">
        {order.number}
      </Link>
      <PageHeader title={messages.purchasing.order.editTitle} description={order.number} />
      <PurchaseOrderForm
        suppliers={suppliers}
        order={{
          id: order.id,
          supplierId: order.supplierId,
          expectedAt: order.expectedAt,
          notes: order.notes,
          lines: order.lines.map((line) => ({
            variantId: line.variantId,
            productName: line.productName,
            label: line.label,
            sku: line.sku,
            orderedQty: line.orderedQty,
            unitCostCents: line.unitCostCents ?? 0,
          })),
        }}
      />
    </div>
  );
}
