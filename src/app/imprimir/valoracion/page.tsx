import Link from "next/link";

import { PrintButton } from "@/components/shared/print-button";
import { buttonVariants } from "@/components/ui/button";
import { messages } from "@/config/messages.es";
import { requirePageCapability } from "@/lib/auth";
import { formatLocalDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { getDeadStock, getInventoryValuation } from "@/modules/reports/queries";
import { getBusinessProfile } from "@/modules/settings/service";
import { AutoPrint } from "@/modules/sales/components/auto-print";

const copy = messages.reports.inventory;
const DEAD_ROWS = 60;

const first = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? "";

/** La valoración del inventario en hoja carta para imprimir o guardar como PDF (solo propietario y gerente). */
export default async function PrintValuationPage({
  searchParams,
}: {
  searchParams: Promise<{ auto?: string; dias?: string }>;
}) {
  await requirePageCapability("report.financial");
  const raw = await searchParams;
  const parsed = Number.parseInt(first(raw.dias), 10);
  const days = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 730) : 90;
  const now = new Date();
  const valuation = await getInventoryValuation();
  const dead = await getDeadStock(days, now, DEAD_ROWS);
  const business = await getBusinessProfile();
  const name = business.tradeName || business.legalName;
  const num = "px-2 py-1 text-right tabular-nums";
  const text = "px-2 py-1";

  return (
    <main className="bg-white p-6 text-sm text-black print:p-0">
      <style>{`@page { size: A4; margin: 15mm; } @media print { .no-print { display: none !important; } }`}</style>
      <div className="no-print mx-auto mb-4 flex max-w-3xl flex-wrap items-center gap-3">
        <Link href="/reportes/inventario" className={buttonVariants({ variant: "outline" })}>
          {copy.title}
        </Link>
        <PrintButton label={messages.reports.export.print} />
      </div>
      {raw.auto === "1" ? <AutoPrint /> : null}

      <article aria-label={copy.valuation.title} className="mx-auto max-w-3xl space-y-5">
        <header className="space-y-0.5 border-b border-black pb-3">
          <h1 className="text-xl font-bold">{name}</h1>
          <p className="text-base font-semibold">{copy.valuation.title}</p>
          <p>{formatLocalDateTime(now)}</p>
        </header>

        <table className="w-full border-collapse">
          <caption className="sr-only">{copy.valuation.title}</caption>
          <thead>
            <tr className="border-b border-black text-left">
              <th className={text}>{copy.valuation.category}</th>
              <th className={`${num} font-semibold`}>{copy.valuation.units}</th>
              <th className={`${num} font-semibold`}>{copy.valuation.cost}</th>
              <th className={`${num} font-semibold`}>{copy.valuation.retail}</th>
            </tr>
          </thead>
          <tbody>
            {valuation.rows.map((row) => (
              <tr key={row.categoryId} className="border-b border-gray-300">
                <td className={text}>{row.categoryName}</td>
                <td className={num}>{row.units}</td>
                <td className={num}>{formatMoney(row.costValueCents)}</td>
                <td className={num}>{formatMoney(row.retailValueCents)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-black font-bold">
              <td className={text}>{copy.valuation.total}</td>
              <td className={num}>{valuation.units}</td>
              <td className={num}>{formatMoney(valuation.costValueCents)}</td>
              <td className={num}>{formatMoney(valuation.retailValueCents)}</td>
            </tr>
          </tfoot>
        </table>
        <p className="text-xs">{copy.valuation.note}</p>

        {dead.rows.length > 0 ? (
          <section className="space-y-2">
            <h2 className="text-base font-semibold">
              {copy.dead.title} ({days} {messages.reports.export.days})
            </h2>
            <p>
              {copy.dead.total}: <strong>{formatMoney(dead.totalCostValueCents)}</strong>
              {dead.total > dead.rows.length
                ? ` · ${copy.dead.shown} ${dead.rows.length} ${copy.dead.of} ${dead.total}`
                : ""}
            </p>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-black text-left">
                  <th className={text}>{copy.dead.product}</th>
                  <th className={text}>{copy.dead.sku}</th>
                  <th className={`${num} font-semibold`}>{copy.dead.onHand}</th>
                  <th className={text}>{copy.dead.last}</th>
                  <th className={`${num} font-semibold`}>{copy.dead.value}</th>
                </tr>
              </thead>
              <tbody>
                {dead.rows.map((row) => (
                  <tr key={row.variantId} className="border-b border-gray-300">
                    <td className={text}>
                      {row.productName}
                      {[row.sizeName, row.colorName].filter(Boolean).length > 0
                        ? ` · ${[row.sizeName, row.colorName].filter(Boolean).join(" · ")}`
                        : ""}
                    </td>
                    <td className={text}>{row.sku}</td>
                    <td className={num}>{row.onHand}</td>
                    <td className={text}>
                      {row.lastSaleAt ? formatLocalDateTime(row.lastSaleAt) : copy.dead.never}
                    </td>
                    <td className={num}>{formatMoney(row.costValueCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}
      </article>
    </main>
  );
}
