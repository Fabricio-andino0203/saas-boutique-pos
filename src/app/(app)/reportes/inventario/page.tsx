import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { messages } from "@/config/messages.es";
import { requirePageCapability } from "@/lib/auth";
import { formatLocalDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { getDeadStock, getInventoryValuation } from "@/modules/reports/queries";

const copy = messages.reports.inventory;

const first = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? "";

export default async function InventoryReportPage({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string }>;
}) {
  // El costo de lo que hay en tienda es información financiera: solo propietario y gerente
  await requirePageCapability("report.financial");
  const raw = await searchParams;
  const parsed = Number.parseInt(first(raw.dias), 10);
  const days = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 730) : 90;

  const valuation = await getInventoryValuation();
  const dead = await getDeadStock(days);
  const num = "text-right tabular-nums";

  return (
    <div className="space-y-8">
      <PageHeader title={copy.title} description={messages.reports.index.inventory.description} />

      <section aria-labelledby="valuation-title" className="space-y-3">
        <h2 id="valuation-title" className="text-lg font-medium">
          {copy.valuation.title}
        </h2>
        {valuation.rows.length === 0 ? (
          <EmptyState title={messages.reports.common.empty} />
        ) : (
          <Table>
            <TableCaption className="sr-only">{copy.valuation.title}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>{copy.valuation.category}</TableHead>
                <TableHead className="text-right">{copy.valuation.units}</TableHead>
                <TableHead className="text-right">{copy.valuation.cost}</TableHead>
                <TableHead className="text-right">{copy.valuation.retail}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {valuation.rows.map((row) => (
                <TableRow key={row.categoryId}>
                  <TableCell>{row.categoryName}</TableCell>
                  <TableCell className={num}>{row.units}</TableCell>
                  <TableCell className={num}>{formatMoney(row.costValueCents)}</TableCell>
                  <TableCell className={num}>{formatMoney(row.retailValueCents)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="font-semibold">{copy.valuation.total}</TableCell>
                <TableCell className={`${num} font-semibold`}>{valuation.units}</TableCell>
                <TableCell className={`${num} font-semibold`}>
                  {formatMoney(valuation.costValueCents)}
                </TableCell>
                <TableCell className={`${num} font-semibold`}>
                  {formatMoney(valuation.retailValueCents)}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        )}
        <p className="text-muted-foreground text-sm">{copy.valuation.note}</p>
      </section>

      <section aria-labelledby="dead-title" className="space-y-3">
        <h2 id="dead-title" className="text-lg font-medium">
          {copy.dead.title}
        </h2>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-sm font-medium">
            {copy.dead.days}
            <Input
              name="dias"
              type="number"
              min={1}
              max={730}
              defaultValue={days}
              className="w-32"
            />
          </label>
          <Button type="submit" variant="outline">
            {copy.dead.apply}
          </Button>
        </form>
        {dead.rows.length === 0 ? (
          <EmptyState title={copy.dead.empty} />
        ) : (
          <>
            <p className="text-sm">
              {copy.dead.total}:{" "}
              <strong className="tabular-nums">{formatMoney(dead.totalCostValueCents)}</strong>
              {dead.total > dead.rows.length
                ? ` · ${copy.dead.shown} ${dead.rows.length} ${copy.dead.of} ${dead.total}`
                : ""}
            </p>
            <Table>
              <TableCaption className="sr-only">{copy.dead.title}</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>{copy.dead.product}</TableHead>
                  <TableHead>{copy.dead.sku}</TableHead>
                  <TableHead className="text-right">{copy.dead.onHand}</TableHead>
                  <TableHead>{copy.dead.last}</TableHead>
                  <TableHead className="text-right">{copy.dead.value}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dead.rows.map((row) => (
                  <TableRow key={row.variantId}>
                    <TableCell>
                      {row.productName}
                      <span className="text-muted-foreground block text-xs">
                        {[row.sizeName, row.colorName].filter(Boolean).join(" · ")}
                      </span>
                    </TableCell>
                    <TableCell>{row.sku}</TableCell>
                    <TableCell className={num}>{row.onHand}</TableCell>
                    <TableCell>
                      {row.lastSaleAt ? formatLocalDateTime(row.lastSaleAt) : copy.dead.never}
                    </TableCell>
                    <TableCell className={num}>{formatMoney(row.costValueCents)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </section>
    </div>
  );
}
