"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";

import { activeHref } from "@/components/layout/active-nav";
import { NavPending } from "@/components/layout/nav-pending";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

export type NavEntry = { href: string; label: string; icon: ReactNode };
/**
 * Una sección del menú. Con `label` es un grupo plegable (y, con el menú reducido a iconos, un solo icono —`icon`— que abre la
 * lista al pasar el mouse); sin `label` son entradas sueltas.
 */
export type NavSection = { label?: string; icon?: ReactNode; items: readonly NavEntry[] };

// ── Qué grupos están abiertos: se recuerda por navegador ──
const STORAGE_KEY = "sidebar-open-groups";
const listeners = new Set<() => void>();
let remembered: string | null | undefined;

function subscribe(listener: () => void) {
  const onStorage = () => {
    remembered = undefined; // otra pestaña cambió la elección: se vuelve a leer
    listener();
  };
  listeners.add(listener);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function readStored(): string | null {
  if (remembered !== undefined) {
    return remembered;
  }
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveOpenGroups(labels: readonly string[]) {
  remembered = JSON.stringify(labels);
  try {
    localStorage.setItem(STORAGE_KEY, remembered);
  } catch {
    // Sin almacenamiento la elección vale mientras la pestaña siga abierta.
  }
  for (const listener of listeners) {
    listener();
  }
}

function parseGroups(raw: string | null): string[] | null {
  if (!raw) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : null;
  } catch {
    return null;
  }
}

/**
 * Menú lateral. Los grupos se pliegan (por omisión solo el primero y el de la pantalla actual están abiertos, y lo que cada
 * quien abre o cierra se recuerda). Con el menú reducido a iconos cada grupo es un solo icono con su lista al lado. La
 * pantalla actual se marca con un fondo suave, una barra rosa a la izquierda y `aria-current`.
 */
export function SidebarNav({ sections }: { sections: readonly NavSection[] }) {
  const pathname = usePathname();
  // El panel de la plataforma vive internamente bajo `/platform`; el navegador ve la dirección sin ese prefijo.
  const path = pathname.replace(/^\/platform(?=\/|$)/, "") || "/";
  const active = activeHref(
    path,
    sections.flatMap((section) => section.items.map((item) => item.href)),
  );
  const { state, isMobile } = useSidebar();
  const rail = state === "collapsed" && !isMobile;

  const labels = sections.flatMap((section) => (section.label ? [section.label] : []));
  const firstLabel = labels[0];
  const activeLabel =
    sections.find((section) => section.label && section.items.some((item) => item.href === active))
      ?.label ?? null;

  const raw = useSyncExternalStore(subscribe, readStored, () => null);
  const saved = useMemo(() => parseGroups(raw), [raw]);
  const open = new Set(saved ?? (firstLabel ? [firstLabel] : []));
  if (saved === null && activeLabel) {
    open.add(activeLabel);
  }

  // Al ir a otra sección, su grupo se abre (y queda así la próxima vez).
  useEffect(() => {
    if (!activeLabel) {
      return;
    }
    const current = parseGroups(readStored()) ?? (firstLabel ? [firstLabel] : []);
    if (!current.includes(activeLabel)) {
      saveOpenGroups([...current, activeLabel]);
    }
  }, [activeLabel, firstLabel]);

  function setGroupOpen(label: string, next: boolean) {
    const current = parseGroups(readStored()) ?? [...open];
    const without = current.filter((item) => item !== label);
    saveOpenGroups(next ? [...without, label] : without);
  }

  // La lista de un grupo en modo iconos se cierra al navegar: se recuerda en qué pantalla se abrió.
  const [flyout, setFlyout] = useState<{ label: string; path: string } | null>(null);

  return (
    <>
      {sections.map((section, index) => {
        const label = section.label;
        if (!label) {
          return (
            <SidebarGroup key={`section-${index}`}>
              <SidebarMenu>
                {section.items.map((item) => (
                  <NavItem key={item.href} item={item} current={item.href === active} tooltip />
                ))}
              </SidebarMenu>
            </SidebarGroup>
          );
        }
        const holdsActive = section.items.some((item) => item.href === active);
        if (rail) {
          return (
            <RailGroup
              key={label}
              section={section}
              label={label}
              active={active}
              holdsActive={holdsActive}
              open={flyout?.label === label && flyout.path === path}
              onOpenChange={(next) => setFlyout(next ? { label, path } : null)}
            />
          );
        }
        return (
          <ExpandedGroup
            key={label}
            section={section}
            label={label}
            active={active}
            holdsActive={holdsActive}
            open={open.has(label)}
            onOpenChange={(next) => setGroupOpen(label, next)}
          />
        );
      })}
    </>
  );
}

function NavItem({
  item,
  current,
  tooltip = false,
}: {
  item: NavEntry;
  current: boolean;
  /** Solo se ve con el menú reducido a iconos. */
  tooltip?: boolean;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={current}
        tooltip={tooltip ? item.label : undefined}
        className="before:bg-sidebar-primary relative before:absolute before:inset-y-1.5 before:left-0 before:hidden before:w-[3px] before:rounded-full data-active:before:block"
        render={<Link href={item.href} aria-current={current ? "page" : undefined} />}
      >
        {item.icon}
        <span>{item.label}</span>
        <NavPending />
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

type GroupProps = {
  section: NavSection;
  label: string;
  active: string | null;
  holdsActive: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Un grupo del menú con su título, plegable. Cerrado, un puntito avisa que la pantalla actual está dentro. */
function ExpandedGroup({ section, label, active, holdsActive, open, onOpenChange }: GroupProps) {
  return (
    <SidebarGroup className="py-0.5">
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CollapsibleTrigger className="group/trigger text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground focus-visible:ring-sidebar-ring flex h-8 w-full items-center gap-2 rounded-md px-2 text-xs font-semibold outline-hidden focus-visible:ring-2">
          <span className="min-w-0 flex-1 truncate text-left">{label}</span>
          {!open && holdsActive ? (
            <span
              aria-hidden="true"
              className="bg-sidebar-primary size-1.5 shrink-0 rounded-full"
            />
          ) : null}
          <ChevronRight
            aria-hidden="true"
            className="size-3.5 shrink-0 transition-transform duration-200 group-data-[panel-open]/trigger:rotate-90"
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenu className="pt-0.5">
            {section.items.map((item) => (
              <NavItem key={item.href} item={item} current={item.href === active} />
            ))}
          </SidebarMenu>
        </CollapsibleContent>
      </Collapsible>
    </SidebarGroup>
  );
}

/** Con el menú reducido a iconos: un icono por grupo; al pasar el mouse (o con Enter) se abre la lista de sus pantallas. */
function RailGroup({ section, label, active, holdsActive, open, onOpenChange }: GroupProps) {
  return (
    <SidebarGroup className="py-0.5">
      <SidebarMenu>
        <SidebarMenuItem>
          <Popover open={open} onOpenChange={onOpenChange}>
            <PopoverTrigger
              openOnHover
              delay={80}
              closeDelay={140}
              render={<SidebarMenuButton isActive={holdsActive} aria-label={label} />}
            >
              {section.icon ?? <span aria-hidden="true">{label.charAt(0)}</span>}
            </PopoverTrigger>
            <PopoverContent side="right" align="start" sideOffset={10}>
              <p className="text-muted-foreground px-2 pt-1 pb-1.5 text-xs font-semibold">
                {label}
              </p>
              <ul className="flex flex-col gap-0.5">
                {section.items.map((item) => {
                  const current = item.href === active;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={current ? "page" : undefined}
                        onClick={() => onOpenChange(false)}
                        className={cn(
                          "hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring/50 flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm outline-hidden focus-visible:ring-2 [&_svg]:size-4 [&_svg]:shrink-0",
                          current && "bg-accent text-accent-foreground font-medium",
                        )}
                      >
                        {item.icon}
                        <span className="min-w-0 truncate">{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </PopoverContent>
          </Popover>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}
