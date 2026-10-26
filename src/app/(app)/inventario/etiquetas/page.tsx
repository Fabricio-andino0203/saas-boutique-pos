import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { buttonVariants } from "@/components/ui/button";
import { messages } from "@/config/messages.es";
import { requirePageCapability } from "@/lib/auth";
import { LabelBuilder } from "@/modules/labels/components/label-builder";
import { getLabelSelection } from "@/modules/labels/service";

const first = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? "";

export default async function LabelsPage({
  searchParams,
}: {
  searchParams: Promise<{ producto?: string; productos?: string; recepcion?: string }>;
}) {
  await requirePageCapability("stock.adjust");
  const raw = await searchParams;
  const productIds = [first(raw.producto), ...first(raw.productos).split(",")].filter(
    (id) => id !== "",
  );
  const receiptId = first(raw.recepcion);
  const initial = await getLabelSelection({
    productIds: productIds.length > 0 ? productIds : undefined,
    receiptId: receiptId || undefined,
  });
  const copy = messages.labels;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title={copy.title}
        description={copy.description}
        actions={
          <Link
            href="/inventario/etiquetas/plantilla"
            className={buttonVariants({ variant: "outline" })}
          >
            {copy.template}
          </Link>
        }
      />
      <LabelBuilder key={`${productIds.join(",")}-${receiptId}`} initial={initial} />
    </div>
  );
}
