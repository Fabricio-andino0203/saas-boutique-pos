import { messages } from "@/config/messages.es";
import { formatLocalDate, formatLocalDateTime, formatLocalTime } from "@/lib/dates";
import { formatMoney, formatPercentBps } from "@/lib/format";
import { mulCents } from "@/lib/money";
import type { SaleDocument } from "@/modules/sales/queries";

const copy = messages.salesDoc;

/** Los pagos tal como se ven en el recibo: "Tarjeta · 4242". */
function paymentLabel(payment: SaleDocument["payments"][number]): string {
  const method = messages.cash.methods[payment.method];
  return payment.reference ? `${method} · ${payment.reference}` : method;
}

function Row({ left, right }: { left: string; right: string }) {
  return (
    <div className="row">
      <span>{left}</span>
      <span>{right}</span>
    </div>
  );
}

/**
 * El recibo de 80 mm para la impresora térmica: una columna angosta, solo blanco y negro, con el orden de siempre de un
 * comprobante: el negocio (con su logo), el título y el número, la fecha, quién atendió, las prendas en columnas, los totales
 * y cómo se pagó. Una venta con factura lleva además el CAI y el rango autorizado. Se imprime con el diálogo del navegador.
 */
export function TicketDocument({ doc }: { doc: SaleDocument }) {
  const name = doc.business.tradeName || doc.business.legalName;
  const invoice = doc.invoice;
  const taxRate = doc.items.find((item) => item.taxRate > 0)?.taxRate ?? 0;
  const taxLabel = `${doc.taxIncluded ? copy.taxIncluded : copy.taxAdded}${taxRate > 0 ? ` (${formatPercentBps(taxRate)} %)` : ""}`;
  const customerName = invoice
    ? (invoice.customerName ?? copy.finalConsumer)
    : (doc.customer?.name ?? copy.finalConsumer);
  const onePayment = doc.payments.length === 1;

  return (
    <>
      <style>{`
        @page { size: 80mm auto; margin: 0; }
        .ticket { width: 72mm; margin: 0 auto; padding: 3mm 1mm 6mm; background: #fff; color: #000;
          font-family: Arial, Helvetica, sans-serif; font-size: 11px; line-height: 1.3;
          -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .ticket .center { text-align: center; }
        .ticket .logo { display: block; margin: 0 auto 2mm; max-width: 100%; max-height: 22mm; }
        .ticket .name { font-size: 15px; font-weight: 700; }
        .ticket .title { margin-top: 2mm; font-size: 13px; font-weight: 700; text-transform: uppercase; }
        .ticket .pill { display: inline-block; margin: 1mm 0 2mm; padding: 1mm 4mm; border-radius: 3mm;
          background: #000; color: #fff; font-size: 14px; font-weight: 700; }
        .ticket .rule { border: 0; border-top: 1.5px solid #000; margin: 2mm 0; }
        .ticket .dash { border: 0; border-top: 1px dashed #000; margin: 2mm 0; }
        .ticket .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5mm 0; margin: 1mm 0 2mm; }
        .ticket .meta > div:nth-child(even) { padding-left: 2.5mm; border-left: 1px solid #000; }
        .ticket .cols { display: grid; grid-template-columns: 7mm 1fr 15mm 17mm; column-gap: 1mm; align-items: start; }
        .ticket .head { padding: 1mm 0; border-top: 1px solid #000; border-bottom: 1px solid #000; font-weight: 700; }
        .ticket .item { padding: 1mm 0 0; }
        .ticket .r { text-align: right; }
        .ticket .small { font-size: 9.5px; }
        .ticket .row { display: flex; justify-content: space-between; gap: 6px; font-size: 12px; }
        .ticket .total { display: flex; justify-content: space-between; align-items: baseline; margin: 1.5mm 0;
          padding: 1.5mm 3mm; border-radius: 2.5mm; background: #000; color: #fff; font-size: 17px; font-weight: 700; }
        .ticket .pay { display: grid; grid-template-columns: 1fr 1fr; gap: 0 3mm; padding: 1.5mm 2mm;
          border: 1px solid #000; border-radius: 2mm; }
        .ticket .pay > div + div { padding-left: 3mm; border-left: 1px solid #000; }
        .ticket .thanks { display: flex; align-items: center; gap: 2mm; margin-top: 3mm; font-size: 13px;
          font-style: italic; font-weight: 600; text-align: center; }
        .ticket .thanks::before, .ticket .thanks::after { content: ""; flex: 1; border-top: 1px solid #000; }
        .ticket .void { border: 2px solid #000; text-align: center; font-weight: 700; font-size: 16px; padding: 2px; margin: 4px 0; }
        @media print { body { background: #fff; } }
      `}</style>
      <article className="ticket" aria-label={`${copy.ticket} ${doc.number}`}>
        <header className="center">
          {doc.logo ? (
            // Un `data:` URI ya reducido a grises por el servidor: next/image no aporta nada al imprimir.
            // eslint-disable-next-line @next/next/no-img-element
            <img className="logo" src={doc.logo} alt="" />
          ) : null}
          <div className="name">{name}</div>
          {doc.business.tradeName && doc.business.legalName !== doc.business.tradeName ? (
            <div>{doc.business.legalName}</div>
          ) : null}
          {doc.business.taxId ? <div>{`${copy.taxId}: ${doc.business.taxId}`}</div> : null}
          {doc.business.address ? <div>{doc.business.address}</div> : null}
          {doc.business.phone ? <div>{`${copy.phoneShort}: ${doc.business.phone}`}</div> : null}
        </header>
        <hr className="rule" />

        {doc.voided ? <div className="void">{copy.voided}</div> : null}
        <div className="center">
          <div className="title">{invoice ? copy.invoice : copy.voucher}</div>
          <span className="pill">{`${copy.numberShort} ${invoice ? invoice.number : doc.number}`}</span>
          {invoice ? <div className="small">{`${copy.internalTicket} ${doc.number}`}</div> : null}
        </div>
        <div className="meta">
          <div>
            <b>{copy.date}:</b> {formatLocalDate(doc.createdAt)}
          </div>
          <div>
            <b>{copy.attendedBy}:</b> {doc.sellerName}
          </div>
          <div>
            <b>{copy.time}:</b> {formatLocalTime(doc.createdAt)}
          </div>
          <div>
            <b>{copy.customer}:</b> {customerName}
          </div>
        </div>
        {invoice?.customerTaxId ? (
          <div>
            <b>{copy.taxId}:</b> {invoice.customerTaxId}
          </div>
        ) : null}

        <div className="cols head">
          <span>{copy.columns.quantity}</span>
          <span>{copy.columns.description}</span>
          <span className="r">{copy.columns.price}</span>
          <span className="r">{copy.columns.total}</span>
        </div>
        {doc.items.map((item) => {
          const label = [item.sizeName, item.colorName].filter(Boolean).join(" · ");
          return (
            <div key={item.id} className="item">
              <div className="cols">
                <span>{item.quantity}</span>
                <span>
                  <b>{item.productName}</b>
                  {label ? (
                    <span className="small" style={{ display: "block" }}>
                      {label}
                    </span>
                  ) : null}
                </span>
                <span className="r">{formatMoney(item.unitPriceCents)}</span>
                <span className="r">
                  {formatMoney(mulCents(item.unitPriceCents, item.quantity))}
                </span>
              </div>
              {item.lineDiscountCents > 0 ? (
                <div className="small r">{`${copy.discountShort} −${formatMoney(item.lineDiscountCents)}`}</div>
              ) : null}
            </div>
          );
        })}
        <hr className="dash" />

        <Row left={`${copy.subtotal}:`} right={formatMoney(doc.grossCents)} />
        {doc.discountCents > 0 ? (
          <Row left={`${copy.discount}:`} right={`−${formatMoney(doc.discountCents)}`} />
        ) : null}
        <Row left={`${taxLabel}:`} right={formatMoney(doc.taxCents)} />
        <div className="total">
          <span>{`${copy.total.toUpperCase()}:`}</span>
          <span>{formatMoney(doc.totalCents)}</span>
        </div>

        <div className="pay">
          <div>
            <div>{`${copy.payments}:`}</div>
            {doc.payments.map((payment, index) => (
              <div key={index}>
                <b>{paymentLabel(payment)}</b>
                {onePayment ? null : ` ${formatMoney(payment.amountCents)}`}
              </div>
            ))}
          </div>
          <div>
            <Row left={`${copy.received}:`} right={formatMoney(doc.paidCents)} />
            <Row left={`${copy.change}:`} right={formatMoney(doc.changeCents)} />
          </div>
        </div>

        {invoice ? (
          <>
            <hr className="dash" />
            <div>{`${copy.cai}: ${invoice.cai}`}</div>
            <div>{`${copy.range}:`}</div>
            <div className="small">{`${invoice.rangeStart} al ${invoice.rangeEnd}`}</div>
            <div>{`${copy.deadline}: ${formatLocalDateTime(invoice.expiresAt).slice(0, 10)}`}</div>
            <div className="center small" style={{ marginTop: 3 }}>
              {copy.copies}
            </div>
          </>
        ) : null}
        {doc.footer ? <div className="thanks">{doc.footer}</div> : null}
        {invoice ? <div className="center small">{copy.benefit}</div> : null}
      </article>
    </>
  );
}
