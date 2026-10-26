import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { messages } from "@/config/messages.es";
import { requirePageCapability } from "@/lib/auth";
import { ImportPanel } from "@/modules/products/import/components/import-panel";

export default async function ImportProductsPage() {
  await requirePageCapability("product.write");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/productos" className="text-muted-foreground text-sm hover:underline">
        {messages.products.import.back}
      </Link>
      <PageHeader
        title={messages.products.import.title}
        description={messages.products.import.description}
      />
      <ImportPanel />
    </div>
  );
}
