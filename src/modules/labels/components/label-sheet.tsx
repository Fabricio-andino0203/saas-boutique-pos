import { messages } from "@/config/messages.es";
import { formatMoney } from "@/lib/format";
import type { LabelTemplate } from "@/lib/settings";
import type { LabelData } from "@/modules/labels/service";

/** Las etiquetas listas para imprimir: el tamaño y la distribución salen de la plantilla. */
export function LabelSheet({ labels, template }: { labels: LabelData[]; template: LabelTemplate }) {
  const { widthMm, heightMm, gapMm, columns, layout } = template;
  const css =
    layout === "roll"
      ? `@page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }
         .label-grid { display: block; }
         .label { break-after: page; }`
      : `@page { size: A4; margin: 8mm; }
         .label-grid { display: grid; grid-template-columns: repeat(${columns}, ${widthMm}mm); gap: ${gapMm}mm; }
         .label { break-inside: avoid; }`;

  return (
    <>
      <style>{`
        ${css}
        .label { box-sizing: border-box; width: ${widthMm}mm; height: ${heightMm}mm; overflow: hidden;
          padding: 1.5mm; display: flex; flex-direction: column; justify-content: space-between;
          font-family: Inter, Arial, sans-serif; color: #000; background: #fff; border: 0.1mm dashed #bbb; }
        .label .name { font-size: 7pt; font-weight: 700; line-height: 1.1; max-height: 2.4em; overflow: hidden; }
        .label .meta { font-size: 6pt; line-height: 1.15; display: flex; justify-content: space-between; gap: 1mm; }
        .label .price { font-size: 9pt; font-weight: 700; white-space: nowrap; flex: none; }
        .label .barcode { flex: 1 1 auto; min-height: 0; display: flex; align-items: center; justify-content: center; }
        .label .barcode svg { width: 100%; height: 100%; max-height: 100%; }
        @media print { .label { border: none; } }
      `}</style>
      <div className="label-grid">
        {labels.map((label, index) => (
          <div
            className="label"
            key={`${label.variantId}-${index}`}
            role="group"
            aria-label={`${messages.labels.print.label} ${label.sku}`}
          >
            {template.showName ? <div className="name">{label.productName}</div> : null}
            {template.showVariant || template.showSku || template.showPrice ? (
              <div className="meta">
                <span>
                  {template.showVariant ? label.variantLabel : ""}
                  {template.showVariant && template.showSku && label.variantLabel ? " · " : ""}
                  {template.showSku ? label.sku : ""}
                </span>
                {template.showPrice ? (
                  <span className="price">{formatMoney(label.priceCents)}</span>
                ) : null}
              </div>
            ) : null}
            <div className="barcode" dangerouslySetInnerHTML={{ __html: label.svg }} />
          </div>
        ))}
      </div>
    </>
  );
}
