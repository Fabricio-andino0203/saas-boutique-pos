import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { buttonVariants } from "@/components/ui/button";
import { messages } from "@/config/messages.es";
import { requirePageCapability } from "@/lib/auth";
import { LabelBuilder } from "@/modules/labels/components/label-builder";
import { getLabelSelection, isLabelQuantityMode, withStock } from "@/modules/labels/service";
import { listVariantsPage } from "@/modules/purchasing/queries";

const first = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? "";

export default async function LabelsPage({
  searchParams,
}: {
  searchParams: Promise<{
    producto?: string;
    productos?: string;
    recepcion?: string;
    cantidad?: string;
  }>;
}) {
  await requirePageCapability("stock.adjust");
  const raw = await searchParams;
  const productIds = [first(raw.producto), ...first(raw.productos).split(",")].filter(
    (id) => id !== "",
  );
  const receiptId = first(raw.recepcion);
  // `cantidad=stock`: las etiquetas arrancan pedidas según el stock; sin eso, una de cada prenda. Se puede cambiar en la pantalla.
  const quantityParam = first(raw.cantidad);
  const quantity = isLabelQuantityMode(quantityParam) ? quantityParam : "one";
  const initial = await getLabelSelection({
    productIds: productIds.length > 0 ? productIds : undefined,
    receiptId: receiptId || undefined,
    quantity,
  });
  const page = await listVariantsPage(0, { includeCost: false });
  const firstPage = { hasMore: page.hasMore, items: await withStock(page.items) };
  const copy = messages.labels;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title={copy.title}
        actions={
          <Link
            href="/inventario/etiquetas/plantilla"
            className={buttonVariants({ variant: "outline" })}
          >
            {copy.template}
          </Link>
        }
      />
      <LabelBuilder
        key={`${productIds.join(",")}-${receiptId}-${quantity}`}
        initial={initial}
        firstPage={firstPage}
      />
    </div>
  );
}
