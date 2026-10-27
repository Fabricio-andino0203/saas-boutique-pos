import { messages } from "@/config/messages.es";
import { formatLocalDateTime } from "@/lib/dates";
import { formatMoney, formatPercentBps } from "@/lib/format";
import type { SaleDocument } from "@/modules/sales/queries";

const copy = messages.salesDoc;

/**
 * La factura en hoja carta/A4 con los datos fiscales: CAI, rango autorizado, fecha límite y los importes
 * exento, gravado e ISV. El formato debe validarse con el contador del negocio antes de usarse como oficial.
 */
export function InvoiceDocument({
  doc,
  invoice,
}: {
  doc: SaleDocument;
  invoice: NonNullable<SaleDocument["invoice"]>;
}) {
  const name = doc.business.tradeName || doc.business.legalName;
  const exemptCents = doc.items
    .filter((item) => item.taxRate === 0)
    .reduce((sum, item) => sum + item.lineTotalCents, 0);
  const taxableCents = doc.items
    .filter((item) => item.taxRate > 0)
    .reduce((sum, item) => sum + item.lineTotalCents - item.taxCents, 0);
  const rate = doc.items.find((item) => item.taxRate > 0)?.taxRate ?? 0;

  return (
    <>
      <style>{`@page { size: A4; margin: 12mm; } @media print { body { background: #fff; } }`}</style>
      <article
        aria-label={`${copy.invoice} ${invoice.number}`}
        className="mx-auto max-w-3xl space-y-5 bg-white text-sm text-black"
      >
        <header className="flex items-start justify-between gap-6">
          <div className="space-y-0.5">
            <h1 className="text-xl font-bold">{name}</h1>
            {doc.business.tradeName && doc.business.legalName !== doc.business.tradeName ? (
              <p>{doc.business.legalName}</p>
            ) : null}
            {doc.business.taxId ? <p>{`${copy.taxId}: ${doc.business.taxId}`}</p> : null}
            {doc.business.address ? <p>{doc.business.address}</p> : null}
            {doc.business.phone ? <p>{doc.business.phone}</p> : null}
          </div>
          <div className="space-y-0.5 text-right">
            <p className="text-lg font-bold">{copy.invoice.toUpperCase()}</p>
            <p className="font-semibold">{invoice.number}</p>
            <p>{`${copy.internalTicket} ${doc.number}`}</p>
            <p>{`${copy.date}: ${formatLocalDateTime(doc.createdAt)}`}</p>
          </div>
        </header>

        {doc.voided ? (
          <p className="border-2 border-black p-2 text-center text-xl font-bold">{copy.voided}</p>
        ) : null}

        <section className="grid grid-cols-2 gap-4 border-y py-3">
          <div>
            <p className="font-semibold">{copy.customer}</p>
            <p>{invoice.customerName ?? copy.finalConsumer}</p>
            {invoice.customerTaxId ? <p>{`${copy.taxId}: ${invoice.customerTaxId}`}</p> : null}
          </div>
          <div>
            <p className="font-semibold">{copy.attendedBy}</p>
            <p>{doc.sellerName}</p>
          </div>
        </section>

        <table className="w-full">
          <thead>
            <tr className="border-b text-left">
              <th className="py-1.5 pr-2 font-semibold">{copy.columns.quantity}</th>
              <th className="py-1.5 pr-2 font-semibold">{copy.columns.description}</th>
              <th className="py-1.5 pr-2 text-right font-semibold">{copy.columns.price}</th>
              <th className="py-1.5 pr-2 text-right font-semibold">{copy.discountShort}</th>
              <th className="py-1.5 text-right font-semibold">{copy.columns.total}</th>
            </tr>
          </thead>
          <tbody>
            {doc.items.map((item) => {
              const label = [item.sizeName, item.colorName].filter(Boolean).join(" · ");
              return (
                <tr key={item.id} className="border-b align-top">
                  <td className="py-1.5 pr-2 tabular-nums">{item.quantity}</td>
                  <td className="py-1.5 pr-2">
                    {item.productName}
                    {label ? <span className="block text-xs">{label}</span> : null}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {formatMoney(item.unitPriceCents)}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {item.lineDiscountCents > 0 ? `−${formatMoney(item.lineDiscountCents)}` : ""}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {formatMoney(item.lineTotalCents)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <dl className="ml-auto grid max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1 tabular-nums">
          <dt>{copy.subtotal}</dt>
          <dd className="text-right">{formatMoney(doc.grossCents)}</dd>
          {doc.discountCents > 0 ? (
            <>
              <dt>{copy.discount}</dt>
              <dd className="text-right">{`−${formatMoney(doc.discountCents)}`}</dd>
            </>
          ) : null}
          <dt>{copy.exempt}</dt>
          <dd className="text-right">{formatMoney(exemptCents)}</dd>
          <dt>{copy.taxable}</dt>
          <dd className="text-right">{formatMoney(taxableCents)}</dd>
          <dt>{`${copy.taxAdded}${rate > 0 ? ` (${formatPercentBps(rate)} %)` : ""}`}</dt>
          <dd className="text-right">{formatMoney(doc.taxCents)}</dd>
          <dt className="text-base font-bold">{copy.total}</dt>
          <dd className="text-right text-base font-bold">{formatMoney(doc.totalCents)}</dd>
        </dl>

        <section className="space-y-0.5 border-t pt-3 text-xs">
          <p>{`${copy.cai}: ${invoice.cai}`}</p>
          <p>{`${copy.range}: ${invoice.rangeStart} al ${invoice.rangeEnd}`}</p>
          <p>{`${copy.deadline}: ${formatLocalDateTime(invoice.expiresAt).slice(0, 10)}`}</p>
          <p>{copy.copies}</p>
          <p className="font-semibold">{copy.benefit}</p>
        </section>
      </article>
    </>
  );
}
