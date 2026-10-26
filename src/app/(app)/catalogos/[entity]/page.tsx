import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shared/page-header";
import { buttonVariants } from "@/components/ui/button";
import { messages } from "@/config/messages.es";
import { requirePageCapability } from "@/lib/auth";
import { CatalogTable } from "@/modules/catalog/components/catalog-table";
import { CATALOG_CONFIG, isCatalogEntity } from "@/modules/catalog/config";
import { listItems } from "@/modules/catalog/service";

type CatalogListPageProps = {
  params: Promise<{ entity: string }>;
  searchParams: Promise<{ archivados?: string | string[] }>;
};

export default async function CatalogListPage({ params, searchParams }: CatalogListPageProps) {
  const { entity } = await params;
  if (!isCatalogEntity(entity)) {
    notFound();
  }
  await requirePageCapability(CATALOG_CONFIG[entity].capability);

  const showArchived = (await searchParams).archivados === "1";
  const labels = messages.catalog.entities[entity];
  const all = await listItems(entity);
  const rows = showArchived ? all : all.filter((row) => !row.archived);
  const hasArchived = all.some((row) => row.archived);

  return (
    <div className="space-y-6">
      <PageHeader
        title={labels.plural}
        actions={
          <Link href={`/catalogos/${entity}/nuevo`} className={buttonVariants()}>
            {labels.new}
          </Link>
        }
      />
      {hasArchived || showArchived ? (
        <Link
          href={showArchived ? `/catalogos/${entity}` : `/catalogos/${entity}?archivados=1`}
          className="text-muted-foreground text-sm underline underline-offset-4"
        >
          {showArchived
            ? messages.catalog.actions.hideArchived
            : messages.catalog.actions.showArchived}
        </Link>
      ) : null}
      <CatalogTable entity={entity} rows={rows} />
    </div>
  );
}
