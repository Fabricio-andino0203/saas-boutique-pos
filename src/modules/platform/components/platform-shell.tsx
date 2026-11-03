import {
  Building2,
  DatabaseBackup,
  LayoutDashboard,
  Layers,
  ScrollText,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { BrandLogo } from "@/components/layout/brand-mark";
import { NavPending } from "@/components/layout/nav-pending";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { messages } from "@/config/messages.es";
import { platformMessages } from "@/config/messages.platform.es";
import { requirePlatformSession } from "@/lib/platform-auth";
import { LogoutButton } from "@/modules/platform/components/logout-button";

const copy = platformMessages.nav;

const navItems: readonly { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/", label: copy.summary, icon: LayoutDashboard },
  { href: "/negocios", label: copy.tenants, icon: Building2 },
  { href: "/planes", label: copy.plans, icon: Layers },
  { href: "/respaldos", label: copy.backups, icon: DatabaseBackup },
  { href: "/administradores", label: copy.admins, icon: ShieldCheck },
  { href: "/auditoria", label: copy.audit, icon: ScrollText },
];

/** Marco del panel de la plataforma: exige una sesión completa (contraseña y código) antes de mostrar nada. */
export async function PlatformShell({ children }: { children: ReactNode }) {
  const { user } = await requirePlatformSession();

  return (
    <SidebarProvider>
      <a
        href="#contenido"
        className="bg-primary text-primary-foreground sr-only rounded-md px-3 py-2 focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50"
      >
        {messages.common.skipToContent}
      </a>
      <Sidebar>
        <SidebarHeader className="border-divider border-b px-4 py-4">
          <BrandLogo caption={platformMessages.app.caption} />
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton render={<Link href={item.href} />}>
                    <item.icon />
                    <span>{item.label}</span>
                    <NavPending />
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <SidebarInset className="min-w-0">
        <header className="border-divider flex h-14 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-5" />
          <div className="ml-auto flex items-center gap-3 text-sm">
            <ThemeToggle />
            <Link href="/cuenta" aria-label={copy.account} className="hover:underline">
              <span className="font-medium">{user.name}</span>
              <span className="text-muted-foreground"> · @{user.username}</span>
            </Link>
            <LogoutButton label={copy.logout} />
          </div>
        </header>
        <main id="contenido" className="min-w-0 flex-1 p-6 md:p-8">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
