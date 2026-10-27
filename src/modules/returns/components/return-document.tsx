import { messages } from "@/config/messages.es";
import { formatLocalDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import type { ReturnDocument } from "@/modules/returns/queries";

const copy = messages.returns.doc;

function Row({ left, right, bold }: { left: string; right: string; bold?: boolean }) {
  return (
    <div className={`row${bold ? "bold" : ""}`}>
      <span>{left}</span>
      <span>{right}</span>
    </div>
  );
}

/** El comprobante de una devolución, de 80 mm como el ticket: qué volvió, cuánto se devolvió y cómo. */
export function ReturnDocumentSheet({ doc }: { doc: ReturnDocument }) {
  const name = doc.business.tradeName || doc.business.legalName;
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
        @media print { body { background: #fff; } }
      `}</style>
      <article className="ticket" aria-label={`${copy.title} ${doc.number}`}>
        <div className="center">
          <div className="title">{name}</div>
          {doc.business.taxId ? (
            <div>{`${messages.salesDoc.taxId}: ${doc.business.taxId}`}</div>
          ) : null}
          {doc.business.address ? <div>{doc.business.address}</div> : null}
          {doc.business.phone ? <div>{doc.business.phone}</div> : null}
        </div>
        <hr />
        <div className="bold">{`${copy.title} ${doc.number}`}</div>
        <div>{`${copy.originalTicket}: ${doc.sale.number}`}</div>
        <div>{`${copy.date}: ${formatLocalDateTime(doc.createdAt)}`}</div>
        <div>{`${copy.attendedBy}: ${doc.processedByName}`}</div>
        {doc.authorizedByName ? <div>{`${copy.authorizedBy}: ${doc.authorizedByName}`}</div> : null}
        {doc.customer ? <div>{`${copy.customer}: ${doc.customer.name}`}</div> : null}
        <div>{`${copy.reason}: ${doc.reason}`}</div>
        <hr />
        {doc.items.map((item) => {
          const label = [item.sizeName, item.colorName].filter(Boolean).join(" · ");
          return (
            <div key={item.id} style={{ marginBottom: 3 }}>
              <div>{item.productName}</div>
              {label ? <div className="sub">{label}</div> : null}
              {item.condition === "DAMAGED" ? <div className="sub">{copy.damaged}</div> : null}
              <Row left={`${item.quantity} ×`} right={formatMoney(item.refundCents)} />
            </div>
          );
        })}
        <hr />
        <div className="row bold big">
          <span>{copy.total}</span>
          <span>{formatMoney(doc.refundCents)}</span>
        </div>
        <Row
          left={copy.method}
          right={
            messages.returns.methods[doc.refundMethod as keyof typeof messages.returns.methods]
          }
        />
        {doc.refundMethod === "STORE_CREDIT" && doc.customer ? (
          <Row left={copy.creditBalance} right={formatMoney(doc.customer.storeCreditCents)} />
        ) : null}
        <hr />
        <div style={{ marginTop: 18 }}>{copy.signature}</div>
        <div style={{ borderTop: "1px solid #000", marginTop: 22 }} />
        {doc.footer ? (
          <div className="center" style={{ marginTop: 6 }}>
            {doc.footer}
          </div>
        ) : null}
      </article>
    </>
  );
}
