import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { messages } from "@/config/messages.es";
import { requirePageCapability } from "@/lib/auth";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { reportAccess } from "@/modules/reports/access";
import { RangeFilter } from "@/modules/reports/components/range-filter";
import { listProductSales, rankProducts } from "@/modules/reports/queries";
import { daysInRange, parseRange } from "@/modules/reports/ranges";

const copy = messages.reports;
const LIMIT = 20;

const first = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? "";

export default async function ProductsReportPage({
  searchParams,
}: {
  searchParams: Promise<{ rango?: string; desde?: string; hasta?: string; orden?: string }>;
}) {
  const { user } = await requirePageCapability("report.view");
  const access = reportAccess(user);
  const raw = await searchParams;
  const range = parseRange({
    rango: first(raw.rango),
    desde: first(raw.desde),
    hasta: first(raw.hasta),
  });
  const order = first(raw.orden) === "menos" ? "worst" : "best";

  const all = await listProductSales(range, daysInRange(range), access.scope);
  const rows = rankProducts(all, order, LIMIT);
  const hrefFor = (next: "mas" | "menos") => {
    const params = new URLSearchParams({ orden: next });
    if (range.preset) {
      params.set("rango", range.preset);
    } else {
      params.set("desde", range.fromKey);
      params.set("hasta", range.toKey);
    }
    return `/reportes/productos?${params.toString()}`;
  };
  const cols = copy.products.columns;
  const num = "text-right tabular-nums";

  return (
    <div className="space-y-6">
      <PageHeader title={copy.products.title} description={copy.index.products.description} />
      {access.seesEveryone ? null : (
        <p role="status" className="bg-muted rounded-lg border px-4 py-2 text-sm">
          {copy.onlyMine}
        </p>
      )}
      <RangeFilter
        path="/reportes/productos"
        range={range}
        params={{ orden: order === "best" ? "mas" : "menos" }}
      />
      <nav aria-label={copy.products.title} className="flex flex-wrap gap-2">
        {(["mas", "menos"] as const).map((option) => {
          const active = (option === "mas") === (order === "best");
          return (
            <Link
              key={option}
              href={hrefFor(option)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "focus-visible:ring-ring/50 min-h-9 rounded-lg border px-3.5 py-1.5 text-sm outline-none focus-visible:ring-3",
                active ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
              )}
            >
              {option === "mas" ? copy.products.order.best : copy.products.order.worst}
            </Link>
          );
        })}
      </nav>

      {rows.length === 0 ? (
        <EmptyState title={copy.common.empty} description={copy.common.emptyHint} />
      ) : (
        <Table>
          <TableCaption className="sr-only">
            {order === "best" ? copy.products.order.best : copy.products.order.worst}
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{cols.product}</TableHead>
              <TableHead>{cols.category}</TableHead>
              <TableHead className="text-right">{cols.units}</TableHead>
              <TableHead className="text-right">{cols.sales}</TableHead>
              <TableHead className="text-right">{cols.onHand}</TableHead>
              <TableHead className="text-right">{cols.rotation}</TableHead>
              <TableHead className="text-right">{cols.days}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.productId}>
                <TableCell>
                  {row.name}
                  <span className="text-muted-foreground block text-xs">{row.code}</span>
                </TableCell>
                <TableCell>{row.categoryName}</TableCell>
                <TableCell className={`${num} font-medium`}>{row.netUnits}</TableCell>
                <TableCell className={num}>{formatMoney(row.soldCents)}</TableCell>
                <TableCell className={num}>{row.onHand}</TableCell>
                <TableCell className={num}>{row.rotation.toFixed(2)}</TableCell>
                <TableCell className={num}>{row.daysOfStock ?? copy.products.none}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <p className="text-muted-foreground text-sm">{copy.products.note}</p>
    </div>
  );
}
