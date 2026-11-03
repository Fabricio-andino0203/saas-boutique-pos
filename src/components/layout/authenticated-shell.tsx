import {
  ArrowLeftRight,
  ChartColumn,
  Barcode,
  Boxes,
  CalendarClock,
  CalendarRange,
  ClipboardList,
  Contact,
  History,
  House,
  Images,
  Landmark,
  LogOut,
  Package,
  PackageCheck,
  Palette,
  PiggyBank,
  ReceiptText,
  Ruler,
  Bookmark,
  ScanBarcode,
  ScrollText,
  Shapes,
  Settings,
  Shirt,
  ShoppingCart,
  SlidersHorizontal,
  Store,
  Tag,
  Tags,
  TriangleAlert,
  Truck,
  Undo2,
  Users,
  UsersRound,
  Wallet,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import { cookies } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";

import { BrandLogo } from "@/components/layout/brand-mark";
import { SidebarNav, type NavEntry } from "@/components/layout/sidebar-nav";
import { SubscriptionBanner } from "@/components/layout/subscription-banner";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { UserAvatar } from "@/components/layout/user-avatar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { messages } from "@/config/messages.es";
import { featureForPath } from "@/config/plan-catalog";
import { requireSession } from "@/lib/auth";
import { currentEntitlements } from "@/lib/entitlements";
import { hasCapability, type Capability } from "@/lib/permissions";
import { includesFeature } from "@/lib/tenancy/billing";
import { logoutAction } from "@/modules/auth/actions";

type NavItem = { href: string; label: string; icon: LucideIcon; capability?: Capability };
type NavGroup = { label: string; icon: LucideIcon; items: readonly NavItem[] };

const homeItem: NavItem = { href: "/", label: messages.nav.home, icon: House };

/** El menú es un componente de cliente (marca la pantalla actual): los iconos viajan ya dibujados, no como funciones. */
const toEntry = (item: NavItem): NavEntry => ({
  href: item.href,
  label: item.label,
  icon: <item.icon />,
});
const navGroups: readonly NavGroup[] = [
  {
    label: messages.nav.groups.sales,
    icon: Store,
    items: [
      { href: "/vender", label: messages.nav.sell, icon: ShoppingCart, capability: "sale.create" },
      {
        href: "/ventas",
        label: messages.nav.salesHistory,
        icon: History,
        capability: "sale.create",
      },
      {
        href: "/devoluciones",
        label: messages.nav.returns,
        icon: Undo2,
        capability: "return.create",
      },
      {
        href: "/apartados",
        label: messages.nav.layaways,
        icon: Bookmark,
        capability: "layaway.manage",
      },
      {
        href: "/reportes",
        label: messages.nav.reports,
        icon: ChartColumn,
        capability: "report.view",
      },
      {
        href: "/caja/cierres",
        label: messages.nav.cashClosings,
        icon: ReceiptText,
        capability: "cash.open",
      },
    ],
  },
  {
    label: messages.nav.groups.merchandise,
    icon: Package,
    items: [
      {
        href: "/productos",
        label: messages.nav.products,
        icon: Shirt,
        capability: "product.write",
      },
      {
        href: "/productos/fotos",
        label: messages.nav.photos,
        icon: Images,
        capability: "product.write",
      },
      {
        href: "/catalogos/categories",
        label: messages.catalog.entities.categories.plural,
        icon: Shapes,
        capability: "product.write",
      },
      {
        href: "/catalogos/brands",
        label: messages.catalog.entities.brands.plural,
        icon: Tag,
        capability: "product.write",
      },
      {
        href: "/catalogos/seasons",
        label: messages.catalog.entities.seasons.plural,
        icon: CalendarRange,
        capability: "product.write",
      },
      {
        href: "/catalogos/sizes",
        label: messages.catalog.entities.sizes.plural,
        icon: Ruler,
        capability: "product.write",
      },
      {
        href: "/catalogos/colors",
        label: messages.catalog.entities.colors.plural,
        icon: Palette,
        capability: "product.write",
      },
    ],
  },
  {
    label: messages.nav.groups.inventory,
    icon: Warehouse,
    items: [
      {
        href: "/inventario",
        label: messages.nav.stock,
        icon: Boxes,
        capability: "stock.adjust",
      },
      {
        href: "/inventario/reposicion",
        label: messages.nav.reorder,
        icon: TriangleAlert,
        capability: "stock.adjust",
      },
      {
        href: "/inventario/etiquetas",
        label: messages.nav.labels,
        icon: Barcode,
        capability: "stock.adjust",
      },
      {
        href: "/inventario/conteos",
        label: messages.nav.counts,
        icon: ScanBarcode,
        capability: "stock.adjust",
      },
      {
        href: "/compras",
        label: messages.nav.purchases,
        icon: ClipboardList,
        capability: "purchase.receive",
      },
      {
        href: "/compras/recepciones",
        label: messages.nav.receipts,
        icon: PackageCheck,
        capability: "purchase.receive",
      },
    ],
  },
  {
    label: messages.nav.groups.people,
    icon: UsersRound,
    items: [
      {
        href: "/clientes",
        label: messages.nav.customers,
        icon: Contact,
        capability: "customer.view",
      },
      {
        href: "/catalogos/suppliers",
        label: messages.catalog.entities.suppliers.plural,
        icon: Truck,
        capability: "purchase.receive",
      },
    ],
  },
  {
    label: messages.nav.groups.finance,
    icon: Wallet,
    items: [
      {
        href: "/finanzas",
        label: messages.nav.financeSummary,
        icon: PiggyBank,
        capability: "finance.view",
      },
      {
        href: "/finanzas/movimientos",
        label: messages.nav.financeEntries,
        icon: ArrowLeftRight,
        capability: "finance.view",
      },
      {
        href: "/finanzas/caja",
        label: messages.nav.financeBox,
        icon: Landmark,
        capability: "finance.view",
      },
      {
        href: "/finanzas/costos-fijos",
        label: messages.nav.financeFixedCosts,
        icon: CalendarClock,
        capability: "finance.view",
      },
      {
        href: "/finanzas/categorias",
        label: messages.nav.financeCategories,
        icon: Tags,
        capability: "finance.view",
      },
    ],
  },
  {
    label: messages.nav.groups.admin,
    icon: SlidersHorizontal,
    items: [
      { href: "/usuarios", label: messages.nav.users, icon: Users, capability: "user.manage" },
      { href: "/auditoria", label: messages.nav.audit, icon: ScrollText, capability: "audit.view" },
      {
        href: "/configuracion",
        label: messages.nav.settings,
        icon: Settings,
        capability: "settings.manage",
      },
    ],
  },
];

export async function AuthenticatedShell({ children }: { children: ReactNode }) {
  const { user } = await requireSession();
  const entitlements = await currentEntitlements();
  // Si la persona dejó el menú reducido a iconos, así vuelve a abrirse (la elección se guarda en una cookie).
  const sidebarOpen = (await cookies()).get("sidebar_state")?.value !== "false";

  // El menú no ofrece lo que el rol no puede hacer ni los módulos que el plan del negocio no incluye (el servidor lo exige igual).
  const visibleGroups = navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        const feature = featureForPath(item.href);
        return (
          (!item.capability || hasCapability(user.role, item.capability)) &&
          (feature === undefined || includesFeature(entitlements, feature))
        );
      }),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <SidebarProvider defaultOpen={sidebarOpen}>
      <a
        href="#contenido"
        className="bg-primary text-primary-foreground sr-only rounded-md px-3 py-2 focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50"
      >
        {messages.common.skipToContent}
      </a>
      <Sidebar collapsible="icon">
        <SidebarHeader className="border-divider border-b px-4 py-4 group-data-[collapsible=icon]:px-2">
          <BrandLogo />
        </SidebarHeader>
        <SidebarContent>
          <SidebarNav
            sections={[
              { items: [toEntry(homeItem)] },
              ...visibleGroups.map((group) => ({
                label: group.label,
                icon: <group.icon />,
                items: group.items.map(toEntry),
              })),
            ]}
          />
        </SidebarContent>
      </Sidebar>
      <SidebarInset className="min-w-0">
        <SubscriptionBanner entitlements={entitlements} />
        <header className="border-divider flex h-14 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-5" />
          <div className="ml-auto flex items-center gap-3 text-sm">
            <ThemeToggle />
            <Link
              href="/cuenta"
              aria-label={messages.nav.account}
              className="hover:bg-accent flex items-center gap-2.5 rounded-lg py-1 pr-2.5 pl-1 transition-colors"
            >
              <UserAvatar name={user.name} />
              <span className="hidden flex-col leading-tight sm:flex">
                <span className="font-medium">{user.name}</span>
                <span className="text-muted-foreground text-xs">
                  {messages.auth.roles[user.role]}
                </span>
              </span>
            </Link>
            <form action={logoutAction}>
              <Button type="submit" variant="outline" size="sm">
                <LogOut aria-hidden="true" />
                {messages.auth.logout}
              </Button>
            </form>
          </div>
        </header>
        <main id="contenido" className="min-w-0 flex-1 p-6 md:p-8">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
