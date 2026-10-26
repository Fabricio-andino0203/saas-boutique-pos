import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shared/page-header";
import { messages } from "@/config/messages.es";
import { requirePageCapability } from "@/lib/auth";
import { ArchiveForm, CatalogForm } from "@/modules/catalog/components/catalog-form";
import { CATALOG_CONFIG, isCatalogEntity } from "@/modules/catalog/config";
import { getFieldOptions, getItem } from "@/modules/catalog/service";

export default async function EditCatalogItemPage({
  params,
}: {
  params: Promise<{ entity: string; id: string }>;
}) {
  const { entity, id } = await params;
  if (!isCatalogEntity(entity)) {
    notFound();
  }
  await requirePageCapability(CATALOG_CONFIG[entity].capability);
  const item = await getItem(entity, id);
  if (!item) {
    notFound();
  }
  const labels = messages.catalog.entities[entity];

  return (
    <div className="mx-auto max-w-md space-y-8">
      <div className="space-y-6">
        <Link
          href={`/catalogos/${entity}`}
          className="text-muted-foreground text-sm hover:underline"
        >
          {messages.catalog.actions.back}
        </Link>
        <PageHeader title={labels.singular} description={item.values.name} />
        <CatalogForm
          entity={entity}
          id={id}
          values={item.values}
          options={await getFieldOptions(entity, id)}
        />
      </div>
      <section className="border-divider border-t pt-6">
        <ArchiveForm entity={entity} id={id} archived={item.archived} />
      </section>
    </div>
  );
}
