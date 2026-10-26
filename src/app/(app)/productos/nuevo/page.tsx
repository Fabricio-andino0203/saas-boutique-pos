import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { messages } from "@/config/messages.es";
import { requirePageCapability } from "@/lib/auth";
import { hasCapability } from "@/lib/permissions";
import { ProductWizard } from "@/modules/products/components/product-wizard";
import { getFormOptions } from "@/modules/products/service";

export default async function NewProductPage() {
  const { user } = await requirePageCapability("product.write");
  const options = await getFormOptions();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/productos" className="text-muted-foreground text-sm hover:underline">
        {messages.products.back}
      </Link>
      <PageHeader
        title={messages.products.wizard.title}
        description={messages.products.wizard.description}
      />
      <ProductWizard options={options} canViewCost={hasCapability(user.role, "product.viewCost")} />
    </div>
  );
}
