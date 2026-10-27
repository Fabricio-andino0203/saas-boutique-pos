import { messages } from "@/config/messages.es";
import { formatLocalDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import type { LayawayReceipt } from "@/modules/layaways/queries";

const copy = messages.layaways.receipt;

function Row({ left, right, bold }: { left: string; right: string; bold?: boolean }) {
  return (
    <div className={bold ? "row bold" : "row"}>
      <span>{left}</span>
      <span>{right}</span>
    </div>
  );
}

/** El recibo de un abono, de 80 mm como el ticket: cuánto se abonó, cuánto lleva pagado y cuánto falta. */
export function LayawayReceiptSheet({ doc }: { doc: LayawayReceipt }) {
  const name = doc.business.tradeName || doc.business.legalName;
  const title = `${copy.title} ${doc.receiptNumber}`;
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
      <article className="ticket" aria-label={title}>
        <div className="center">
          <div className="title">{name}</div>
          {doc.business.taxId ? (
            <div>{`${messages.salesDoc.taxId}: ${doc.business.taxId}`}</div>
          ) : null}
          {doc.business.address ? <div>{doc.business.address}</div> : null}
          {doc.business.phone ? <div>{doc.business.phone}</div> : null}
        </div>
        <hr />
        <div className="bold">{title}</div>
        <div>{`${copy.layaway}: ${doc.layaway.number}`}</div>
        <div>{`${copy.customer}: ${doc.layaway.customerName}`}</div>
        <div>{`${copy.date}: ${formatLocalDateTime(doc.createdAt)}`}</div>
        <div>{`${copy.receivedBy}: ${doc.receivedByName}`}</div>
        <hr />
        <div className="bold">{copy.items}</div>
        {doc.layaway.items.map((item, index) => {
          const label = [item.sizeName, item.colorName].filter(Boolean).join(" · ");
          return (
            <div key={`${item.productName}-${index}`} style={{ marginBottom: 2 }}>
              <div>{`${item.quantity} × ${item.productName}`}</div>
              {label ? <div className="sub">{label}</div> : null}
            </div>
          );
        })}
        <hr />
        <div className="row bold big">
          <span>{copy.thisPayment}</span>
          <span>{formatMoney(doc.amountCents)}</span>
        </div>
        <Row
          left={copy.method}
          right={`${messages.cash.methods[doc.method]}${doc.reference ? ` · ${doc.reference}` : ""}`}
        />
        <hr />
        <Row left={copy.total} right={formatMoney(doc.layaway.totalCents)} />
        <Row left={copy.paidSoFar} right={formatMoney(doc.layaway.paidUntilHereCents)} />
        <Row left={copy.balance} right={formatMoney(doc.layaway.balanceAfterCents)} bold />
        <div>{`${copy.expires} ${formatLocalDateTime(doc.layaway.expiresAt)}`}</div>
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
