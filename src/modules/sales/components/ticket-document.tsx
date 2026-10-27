import { messages } from "@/config/messages.es";
import { formatLocalDateTime } from "@/lib/dates";
import { formatMoney, formatPercentBps } from "@/lib/format";
import type { SaleDocument } from "@/modules/sales/queries";

const copy = messages.salesDoc;

/** Los pagos tal como se ven en el ticket: "Tarjeta · 4242". */
function paymentLabel(payment: SaleDocument["payments"][number]): string {
  const method =
    messages.pos.charge.methods[payment.method as keyof typeof messages.pos.charge.methods] ??
    payment.method;
  return payment.reference ? `${method} · ${payment.reference}` : method;
}

function Row({ left, right, bold }: { left: string; right: string; bold?: boolean }) {
  return (
    <div className={`row${bold ? "bold" : ""}`}>
      <span>{left}</span>
      <span>{right}</span>
    </div>
  );
}

/**
 * El ticket de 80 mm para la impresora térmica: una columna angosta, letra de ancho fijo, sin colores. Se imprime
 * con el diálogo del navegador (la impresión directa a la térmica llega en la Fase 6).
 */
export function TicketDocument({ doc }: { doc: SaleDocument }) {
  const name = doc.business.tradeName || doc.business.legalName;
  const invoice = doc.invoice;
  const taxRate = doc.items.find((item) => item.taxRate > 0)?.taxRate ?? 0;

  return (
    <>
      <style>{`
        @page { size: 80mm auto; margin: 0; }
        .ticket { width: 72mm; margin: 0 auto; padding: 3mm 1mm 6mm; background: #fff; color: #000;
          font-family: "Courier New", ui-monospace, monospace; font-size: 11px; line-height: 1.35; }
        .ticket .center { text-align: center; }
        .ticket .title { font-size: 14px; font-weight: 700; }
        .ticket .row { display: flex; justify-content: space-between; gap: 6px; }
        .ticket .bold { font-weight: 700; }
        .ticket .big { font-size: 15px; }
        .ticket hr { border: 0; border-top: 1px dashed #000; margin: 5px 0; }
        .ticket .sub { padding-left: 8px; font-size: 10px; }
        .ticket .void { border: 2px solid #000; text-align: center; font-weight: 700; font-size: 16px; padding: 2px; margin: 4px 0; }
        @media print { body { background: #fff; } }
      `}</style>
      <article className="ticket" aria-label={`${copy.ticket} ${doc.number}`}>
        <div className="center">
          <div className="title">{name}</div>
          {doc.business.tradeName && doc.business.legalName !== doc.business.tradeName ? (
            <div>{doc.business.legalName}</div>
          ) : null}
          {doc.business.taxId ? <div>{`${copy.taxId}: ${doc.business.taxId}`}</div> : null}
          {doc.business.address ? <div>{doc.business.address}</div> : null}
          {doc.business.phone ? <div>{doc.business.phone}</div> : null}
        </div>
        <hr />
        {doc.voided ? <div className="void">{copy.voided}</div> : null}
        <div className="bold">
          {invoice ? `${copy.invoice} ${invoice.number}` : `${copy.ticket} ${doc.number}`}
        </div>
        {invoice ? <div>{`${copy.internalTicket} ${doc.number}`}</div> : null}
        <div>{`${copy.date}: ${formatLocalDateTime(doc.createdAt)}`}</div>
        <div>{`${copy.attendedBy}: ${doc.sellerName}`}</div>
        {invoice ? (
          <>
            <div>{`${copy.customer}: ${invoice.customerName ?? copy.finalConsumer}`}</div>
            {invoice.customerTaxId ? <div>{`${copy.taxId}: ${invoice.customerTaxId}`}</div> : null}
          </>
        ) : doc.customer ? (
          <div>{`${copy.customer}: ${doc.customer.name}`}</div>
        ) : null}
        <hr />
        {doc.items.map((item) => {
          const label = [item.sizeName, item.colorName].filter(Boolean).join(" · ");
          return (
            <div key={item.id} style={{ marginBottom: 3 }}>
              <div>{item.productName}</div>
              {label ? <div className="sub">{label}</div> : null}
              <Row
                left={`${item.quantity} × ${formatMoney(item.unitPriceCents)}`}
                right={formatMoney(item.unitPriceCents * item.quantity)}
              />
              {item.lineDiscountCents > 0 ? (
                <Row
                  left={`  ${copy.discountShort}`}
                  right={`−${formatMoney(item.lineDiscountCents)}`}
                />
              ) : null}
            </div>
          );
        })}
        <hr />
        <Row left={copy.subtotal} right={formatMoney(doc.grossCents)} />
        {doc.discountCents > 0 ? (
          <Row left={copy.discount} right={`−${formatMoney(doc.discountCents)}`} />
        ) : null}
        <Row
          left={`${doc.taxIncluded ? copy.taxIncluded : copy.taxAdded}${taxRate > 0 ? ` (${formatPercentBps(taxRate)} %)` : ""}`}
          right={formatMoney(doc.taxCents)}
        />
        <div className="row bold big">
          <span>{copy.total.toUpperCase()}</span>
          <span>{formatMoney(doc.totalCents)}</span>
        </div>
        <hr />
        <div className="bold">{copy.payments}</div>
        {doc.payments.map((payment, index) => (
          <Row key={index} left={paymentLabel(payment)} right={formatMoney(payment.amountCents)} />
        ))}
        <Row left={copy.received} right={formatMoney(doc.paidCents)} />
        <Row left={copy.change} right={formatMoney(doc.changeCents)} />
        {invoice ? (
          <>
            <hr />
            <div>{`${copy.cai}: ${invoice.cai}`}</div>
            <div>{`${copy.range}:`}</div>
            <div className="sub">{`${invoice.rangeStart} al ${invoice.rangeEnd}`}</div>
            <div>{`${copy.deadline}: ${formatLocalDateTime(invoice.expiresAt).slice(0, 10)}`}</div>
            <div className="center" style={{ marginTop: 3 }}>
              {copy.copies}
            </div>
          </>
        ) : null}
        <hr />
        {doc.footer ? <div className="center">{doc.footer}</div> : null}
        {invoice ? <div className="center">{copy.benefit}</div> : null}
      </article>
    </>
  );
}
