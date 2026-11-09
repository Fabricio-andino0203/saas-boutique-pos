import { BarChart3, Boxes, Grid3x3, Receipt, ShoppingBag } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { messages } from "@/config/messages.es";
import { requirePageCapability } from "@/lib/auth";
import { hasCapability } from "@/lib/permissions";

const copy = messages.reports;

export default async function ReportsPage() {
  const { user } = await requirePageCapability("report.view");
  const cards = [
    { href: "/reportes/ventas", icon: BarChart3, ...copy.index.sales, show: true },
    { href: "/reportes/productos", icon: ShoppingBag, ...copy.index.products, show: true },
    { href: "/reportes/tallas", icon: Grid3x3, ...copy.index.sizes, show: true },
    {
      href: "/reportes/cierres",
      icon: Receipt,
      ...copy.index.closings,
      show: hasCapability(user.role, "cash.viewOthers"),
    },
    {
      href: "/reportes/inventario",
      icon: Boxes,
      ...copy.index.inventory,
      show: hasCapability(user.role, "report.financial"),
    },
  ].filter((card) => card.show);

  return (
    <div className="space-y-6">
      <PageHeader title={copy.title} />
      <ul className="grid gap-4 sm:grid-cols-2">
        {cards.map((card) => (
          <li key={card.href}>
            <Link
              href={card.href}
              className="hover:border-primary focus-visible:ring-ring/50 bg-card flex h-full gap-4 rounded-lg border p-4 outline-none focus-visible:ring-3"
            >
              <card.icon aria-hidden="true" className="text-primary mt-0.5 size-6 shrink-0" />
              <span className="space-y-1">
                <span className="block font-medium">{card.title}</span>
                <span className="text-muted-foreground block text-sm">{card.description}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
