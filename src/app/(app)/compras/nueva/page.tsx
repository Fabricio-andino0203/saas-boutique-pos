import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { messages } from "@/config/messages.es";
import { requirePageCapability } from "@/lib/auth";
import { PurchaseOrderForm } from "@/modules/purchasing/components/purchase-order-form";
import { listSupplierOptions } from "@/modules/purchasing/queries";

export default async function NewPurchaseOrderPage() {
  await requirePageCapability("purchase.receive");
  await requirePageCapability("product.viewCost");
  const suppliers = await listSupplierOptions();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link href="/compras" className="text-muted-foreground text-sm hover:underline">
        {messages.purchasing.back}
      </Link>
      <PageHeader title={messages.purchasing.order.newTitle} />
      <PurchaseOrderForm suppliers={suppliers} />
    </div>
  );
}
