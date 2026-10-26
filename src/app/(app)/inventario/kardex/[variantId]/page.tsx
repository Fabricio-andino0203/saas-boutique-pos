import Link from "next/link";
import { notFound } from "next/navigation";

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
import { formatLocalDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { hasCapability } from "@/lib/permissions";
import { getKardex } from "@/modules/inventory/queries";

export default async function KardexPage({
  params,
  searchParams,
}: {
  params: Promise<{ variantId: string }>;
  searchParams: Promise<{ pagina?: string }>;
}) {
  const { user } = await requirePageCapability("stock.adjust");
  const { variantId } = await params;
  const page = Math.max(1, Number.parseInt((await searchParams).pagina ?? "", 10) || 1);
  const kardex = await getKardex(variantId, { page });
  if (!kardex) {
    notFound();
  }
  const showCost = hasCapability(user.role, "product.viewCost");
  const copy = messages.inventory.kardex;
  const heads = copy.columns;
  const { header } = kardex;
  const variantLabel = [header.sizeName, header.colorName].filter(Boolean).join(" · ");
  const lastPage = Math.max(1, Math.ceil(kardex.total / kardex.pageSize));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Link href="/inventario" className="text-muted-foreground text-sm hover:underline">
        {copy.back}
      </Link>
      <PageHeader
        title={`${copy.title}: ${header.productName}${variantLabel ? ` · ${variantLabel}` : ""}`}
        description={copy.description}
      />

      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="bg-card rounded-lg border p-4">
          <dt className="text-muted-foreground text-sm">{copy.current}</dt>
          <dd className="text-xl font-semibold tabular-nums">{header.onHand}</dd>
        </div>
        {showCost ? (
          <div className="bg-card rounded-lg border p-4">
            <dt className="text-muted-foreground text-sm">{copy.avgCost}</dt>
            <dd className="text-xl font-semibold tabular-nums">
              {formatMoney(header.avgCostCents)}
            </dd>
          </div>
        ) : null}
        <div className="bg-card rounded-lg border p-4">
          <dt className="text-muted-foreground text-sm">{copy.sku}</dt>
          <dd className="font-mono text-sm">{header.sku}</dd>
        </div>
        <div className="bg-card rounded-lg border p-4">
          <dt className="text-muted-foreground text-sm">{copy.barcode}</dt>
          <dd className="font-mono text-sm">{header.barcode}</dd>
        </div>
      </dl>

      {kardex.rows.length === 0 ? (
        <EmptyState title={copy.empty.title} description={copy.empty.description} />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableCaption className="sr-only">{copy.title}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>{heads.date}</TableHead>
                <TableHead>{heads.type}</TableHead>
                <TableHead className="text-right">{heads.quantity}</TableHead>
                <TableHead className="text-right">{heads.balance}</TableHead>
                {showCost ? <TableHead className="text-right">{heads.cost}</TableHead> : null}
                <TableHead>{heads.user}</TableHead>
                <TableHead>{heads.document}</TableHead>
                <TableHead>{heads.reason}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {kardex.rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap">
                    {formatLocalDateTime(row.createdAt)}
                  </TableCell>
                  <TableCell>{messages.inventory.types[row.type]}</TableCell>
                  <TableCell
                    className={
                      row.quantity < 0
                        ? "text-destructive text-right tabular-nums"
                        : "text-success text-right tabular-nums"
                    }
                  >
                    {row.quantity > 0 ? `+${row.quantity}` : `−${Math.abs(row.quantity)}`}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{row.balance}</TableCell>
                  {showCost ? (
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(row.unitCostCents)}
                    </TableCell>
                  ) : null}
                  <TableCell>{row.userName}</TableCell>
                  <TableCell>
                    {row.document ? (
                      row.document.href ? (
                        <Link
                          href={row.document.href}
                          className="text-primary underline underline-offset-4"
                        >
                          {row.document.label}
                        </Link>
                      ) : (
                        row.document.label
                      )
                    ) : null}
                  </TableCell>
                  <TableCell>{row.reason ?? ""}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <nav aria-label={copy.title} className="flex items-center justify-between gap-4 text-sm">
        <span className="text-muted-foreground">{kardex.total}</span>
        <div className="flex gap-4">
          {kardex.page > 1 ? (
            <Link
              href={`/inventario/kardex/${variantId}${kardex.page > 2 ? `?pagina=${kardex.page - 1}` : ""}`}
              className="underline underline-offset-4"
            >
              {messages.products.pagination.previous}
            </Link>
          ) : null}
          {kardex.page < lastPage ? (
            <Link
              href={`/inventario/kardex/${variantId}?pagina=${kardex.page + 1}`}
              className="underline underline-offset-4"
            >
              {messages.products.pagination.next}
            </Link>
          ) : null}
        </div>
      </nav>
    </div>
  );
}
