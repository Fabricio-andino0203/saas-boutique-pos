import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { buttonVariants } from "@/components/ui/button";
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
import { hasCapability } from "@/lib/permissions";
import { listReorderAlerts } from "@/modules/inventory/reorder";

export default async function ReorderPage() {
  const { user } = await requirePageCapability("stock.adjust");
  const alerts = await listReorderAlerts();
  const copy = messages.reorder;
  const heads = copy.columns;
  const canOrder =
    hasCapability(user.role, "purchase.receive") && hasCapability(user.role, "product.viewCost");

  return (
    <div className="space-y-6">
      <PageHeader
        title={copy.title}
        description={copy.description}
        actions={
          canOrder ? (
            <Link href="/compras/nueva" className={buttonVariants()}>
              {copy.order}
            </Link>
          ) : null
        }
      />
      {alerts.length === 0 ? (
        <EmptyState title={copy.empty.title} description={copy.empty.description} />
      ) : (
        <>
          <div className="overflow-x-auto">
            <Table>
              <TableCaption className="sr-only">{copy.title}</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>{heads.product}</TableHead>
                  <TableHead>{heads.sku}</TableHead>
                  <TableHead className="text-right">{heads.onHand}</TableHead>
                  <TableHead className="text-right">{heads.minimum}</TableHead>
                  <TableHead className="text-right">{heads.missing}</TableHead>
                  <TableHead className="text-right">{heads.onOrder}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alerts.map((alert) => (
                  <TableRow key={alert.variantId}>
                    <TableCell>
                      <Link
                        href={`/inventario/kardex/${alert.variantId}`}
                        className="text-primary font-medium underline underline-offset-4"
                      >
                        {[alert.productName, alert.label].filter(Boolean).join(" · ")}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{alert.sku}</TableCell>
                    <TableCell className="text-destructive text-right tabular-nums">
                      {alert.onHand}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{alert.reorderPoint}</TableCell>
                    <TableCell className="text-right tabular-nums">{alert.missing}</TableCell>
                    <TableCell className="text-right tabular-nums">{alert.onOrder}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-muted-foreground text-sm">{copy.howTo}</p>
        </>
      )}
    </div>
  );
}
