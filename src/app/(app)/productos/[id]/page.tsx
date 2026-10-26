import Link from "next/link";
import { notFound } from "next/navigation";

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
import { ProductActions } from "@/modules/products/components/product-actions";
import { ProductDetailForm } from "@/modules/products/components/product-detail-form";
import { VariantsSection } from "@/modules/products/components/variants-section";
import { getFormOptions, getProduct } from "@/modules/products/service";

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ creado?: string }>;
}) {
  const { user } = await requirePageCapability("product.write");
  const { id } = await params;
  const justCreated = (await searchParams).creado === "1";
  const product = await getProduct(id);
  if (!product) {
    notFound();
  }
  const options = await getFormOptions({
    categoryId: product.categoryId,
    brandId: product.brandId || undefined,
    seasonId: product.seasonId || undefined,
    supplierId: product.supplierId || undefined,
  });
  const canViewCost = hasCapability(user.role, "product.viewCost");
  const canChangePrice = hasCapability(user.role, "price.change");
  const copy = messages.products.detail;
  const heads = copy.historyColumns;

  return (
    <div className="mx-auto max-w-5xl space-y-10">
      <div className="space-y-6">
        <Link href="/productos" className="text-muted-foreground text-sm hover:underline">
          {messages.products.back}
        </Link>
        <PageHeader title={product.name} description={`${copy.codeLabel}: ${product.code}`} />
        {justCreated ? (
          <p role="status" className="text-success text-sm">
            {messages.products.created}
          </p>
        ) : null}
        {product.archived ? (
          <p role="status" className="bg-muted rounded-lg p-3 text-sm">
            {copy.archivedBanner}
          </p>
        ) : null}
      </div>

      <ProductDetailForm
        key={`${product.id}-${product.basePriceCents}-${product.baseCostCents}-${product.name}`}
        product={product}
        options={options}
        canViewCost={canViewCost}
        canChangePrice={canChangePrice && !product.archived}
      />

      <VariantsSection
        productId={product.id}
        variants={product.variants}
        options={options}
        canViewCost={canViewCost}
        canChangePrice={canChangePrice}
        productArchived={product.archived}
      />

      <ProductActions productId={product.id} archived={product.archived} />

      {canChangePrice ? (
        <section aria-labelledby="history-title" className="space-y-3">
          <h2 id="history-title" className="text-lg font-medium">
            {copy.historyTitle}
          </h2>
          {product.history.length === 0 ? (
            <p className="text-muted-foreground text-sm">{copy.historyEmpty}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableCaption className="sr-only">{copy.historyTitle}</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>{heads.date}</TableHead>
                    <TableHead>{heads.who}</TableHead>
                    <TableHead>{heads.what}</TableHead>
                    <TableHead className="text-right">{heads.price}</TableHead>
                    {canViewCost ? (
                      <TableHead className="text-right">{heads.cost}</TableHead>
                    ) : null}
                    <TableHead>{heads.reason}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {product.history.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>{formatLocalDateTime(row.changedAt)}</TableCell>
                      <TableCell>{row.changedBy}</TableCell>
                      <TableCell>{row.variantLabel ?? copy.historyProduct}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(row.oldPriceCents)} → {formatMoney(row.newPriceCents)}
                      </TableCell>
                      {canViewCost ? (
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(row.oldCostCents)} → {formatMoney(row.newCostCents)}
                        </TableCell>
                      ) : null}
                      <TableCell>{row.reason ?? ""}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
