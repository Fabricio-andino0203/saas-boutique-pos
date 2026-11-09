import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { Notice } from "@/components/shared/notice";
import { messages } from "@/config/messages.es";
import { requirePageCapability } from "@/lib/auth";
import { LabelSheet } from "@/modules/labels/components/label-sheet";
import { PrintButton } from "@/modules/labels/components/print-button";
import { buildLabels, getLabelTemplate, type LabelItem } from "@/modules/labels/service";

/** Cada `v=idDeVariante:cantidad` de la dirección es una prenda con sus etiquetas. */
function parseItems(value: string | string[] | undefined): LabelItem[] {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list.flatMap((entry) => {
    const [variantId, quantity] = entry.split(":");
    const count = Number(quantity);
    return variantId && Number.isInteger(count) && count > 0
      ? [{ variantId, quantity: count }]
      : [];
  });
}

export default async function PrintLabelsPage({
  searchParams,
}: {
  searchParams: Promise<{ v?: string | string[] }>;
}) {
  await requirePageCapability("stock.adjust");
  const items = parseItems((await searchParams).v);
  const copy = messages.labels.print;
  const template = await getLabelTemplate();

  let labels;
  try {
    labels = items.length > 0 ? await buildLabels(items) : [];
  } catch {
    labels = null;
  }

  return (
    <main className="bg-white p-4 text-black print:p-0">
      <style>{`@media print { .no-print { display: none !important; } body { background: #fff; } }`}</style>
      <div className="no-print mx-auto mb-4 flex max-w-3xl flex-wrap items-center gap-3">
        <Link href="/inventario/etiquetas" className={buttonVariants({ variant: "outline" })}>
          {copy.back}
        </Link>
        {labels && labels.length > 0 ? <PrintButton /> : null}
        <span className="text-sm">
          {labels ? labels.length : 0} {copy.summary} · {template.widthMm}×{template.heightMm} mm
        </span>
        <p className="text-muted-foreground w-full text-sm">{copy.hint}</p>
      </div>
      {labels === null ? (
        <Notice tone="error">{copy.invalid}</Notice>
      ) : labels.length === 0 ? (
        <p className="no-print">{copy.empty}</p>
      ) : (
        <LabelSheet labels={labels} template={template} />
      )}
    </main>
  );
}
