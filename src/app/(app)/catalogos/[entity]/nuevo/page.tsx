import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shared/page-header";
import { messages } from "@/config/messages.es";
import { requirePageCapability } from "@/lib/auth";
import { CatalogForm } from "@/modules/catalog/components/catalog-form";
import { CATALOG_CONFIG, isCatalogEntity } from "@/modules/catalog/config";
import { getFieldOptions } from "@/modules/catalog/service";

export default async function NewCatalogItemPage({
  params,
}: {
  params: Promise<{ entity: string }>;
}) {
  const { entity } = await params;
  if (!isCatalogEntity(entity)) {
    notFound();
  }
  await requirePageCapability(CATALOG_CONFIG[entity].capability);
  const labels = messages.catalog.entities[entity];

  return (
    <div className="mx-auto max-w-md space-y-6">
      <Link href={`/catalogos/${entity}`} className="text-muted-foreground text-sm hover:underline">
        {messages.catalog.actions.back}
      </Link>
      <PageHeader title={labels.new} />
      <CatalogForm entity={entity} id={null} options={await getFieldOptions(entity)} />
    </div>
  );
}
