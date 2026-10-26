import { House, LogOut, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { messages } from "@/config/messages.es";
import { requireSession } from "@/lib/auth";
import { hasCapability, type Capability } from "@/lib/permissions";
import { logoutAction } from "@/modules/auth/actions";

type NavItem = { href: string; label: string; icon: LucideIcon; capability?: Capability };
type NavGroup = { label: string; items: readonly NavItem[] };

const homeItem: NavItem = { href: "/", label: messages.nav.home, icon: House };
const navGroups: readonly NavGroup[] = [];

export async function AuthenticatedShell({ children }: { children: ReactNode }) {
  const { user } = await requireSession();

  const visibleGroups = navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) => !item.capability || hasCapability(user.role, item.capability),
      ),
    }))
    .filter((group) => group.items.length > 0);

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
          <span className="text-lg font-semibold tracking-tight">{messages.app.name}</span>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton render={<Link href={homeItem.href} />}>
                  <homeItem.icon />
                  <span>{homeItem.label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
          {visibleGroups.map((group) => (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton render={<Link href={item.href} />}>
                      <item.icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          ))}
        </SidebarContent>
      </Sidebar>
      <SidebarInset>
        <header className="border-divider flex h-14 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-5" />
          <div className="ml-auto flex items-center gap-3 text-sm">
            <Link href="/cuenta" aria-label={messages.nav.account} className="hover:underline">
              <span className="font-medium">{user.name}</span>
              <span className="text-muted-foreground"> · {messages.auth.roles[user.role]}</span>
            </Link>
            <form action={logoutAction}>
              <Button type="submit" variant="outline" size="sm">
                <LogOut aria-hidden="true" />
                {messages.auth.logout}
              </Button>
            </form>
          </div>
        </header>
        <main id="contenido" className="flex-1 p-6 md:p-8">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
