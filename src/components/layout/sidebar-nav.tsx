"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { activeHref } from "@/components/layout/active-nav";
import { NavPending } from "@/components/layout/nav-pending";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

export type NavEntry = { href: string; label: string; icon: ReactNode };
export type NavSection = { label?: string; items: readonly NavEntry[] };

/** Menú lateral: marca la pantalla actual con un fondo suave y una barra rosa a la izquierda (y `aria-current`). */
export function SidebarNav({ sections }: { sections: readonly NavSection[] }) {
  const pathname = usePathname();
  // El panel de la plataforma vive internamente bajo `/platform`; el navegador ve la dirección sin ese prefijo.
  const path = pathname.replace(/^\/platform(?=\/|$)/, "") || "/";
  const active = activeHref(
    path,
    sections.flatMap((section) => section.items.map((item) => item.href)),
  );

  return (
    <>
      {sections.map((section, index) => (
        <SidebarGroup key={section.label ?? `section-${index}`}>
          {section.label ? <SidebarGroupLabel>{section.label}</SidebarGroupLabel> : null}
          <SidebarMenu>
            {section.items.map((item) => {
              const current = item.href === active;
              return (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    isActive={current}
                    className="before:bg-sidebar-primary relative before:absolute before:inset-y-1.5 before:left-0 before:hidden before:w-[3px] before:rounded-full data-active:before:block"
                    render={<Link href={item.href} aria-current={current ? "page" : undefined} />}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                    <NavPending />
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      ))}
    </>
  );
}
