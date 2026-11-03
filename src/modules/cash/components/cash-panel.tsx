"use client";

import { Banknote } from "lucide-react";
import Link from "next/link";
import { useRef, useState, useTransition, type KeyboardEvent } from "react";

import { Notice } from "@/components/shared/notice";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { messages } from "@/config/messages.es";
import { formatLocalDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { loadCashPanelAction } from "@/modules/cash/actions";
import { CashMovementForm } from "@/modules/cash/components/cash-movement-form";
import { CloseCashForm } from "@/modules/cash/components/close-cash-form";
import type { CashPanelData, CashPanelState } from "@/modules/cash/types";

const copy = messages.cash;
const panel = copy.panel;

const TABS = ["shift", "movements", "close"] as const;
type Tab = (typeof TABS)[number];

type CashPanelProps = {
  /** La caja abierta de la terminal es de quien está en pantalla; si no, el panel solo lo explica. */
  ownSession: boolean;
  /** Quién abrió la caja de la terminal (para explicarlo cuando no es quien está en pantalla). */
  openedByName: string;
  /** El punto de venta pausa sus atajos mientras el panel está abierto. */
  onOpenChange?: (open: boolean) => void;
};

/**
 * Las opciones de la caja dentro de Vender: el turno, las entradas y salidas de efectivo y el cierre. Los datos se piden al
 * abrir y otra vez tras cada cambio, así lo que ven coincide con las ventas que se acaban de cobrar.
 */
export function CashPanel({ ownSession, openedByName, onOpenChange }: CashPanelProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("shift");
  const [state, setState] = useState<CashPanelState | null>(null);
  const [pending, startTransition] = useTransition();
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({
    shift: null,
    movements: null,
    close: null,
  });

  function load() {
    startTransition(async () => {
      setState(await loadCashPanelAction());
    });
  }

  function changeOpen(next: boolean) {
    setOpen(next);
    onOpenChange?.(next);
    if (next) {
      setTab("shift");
      setState(null);
      if (ownSession) {
        load();
      }
    }
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) {
      return;
    }
    event.preventDefault();
    const next = TABS[(TABS.indexOf(tab) + step + TABS.length) % TABS.length] as Tab;
    setTab(next);
    tabRefs.current[next]?.focus();
  }

  const data = state && "data" in state ? state.data : null;

  return (
    <Sheet open={open} onOpenChange={changeOpen}>
      <SheetTrigger render={<Button type="button" variant="outline" />}>
        <Banknote aria-hidden="true" />
        {messages.pos.actions.cash}
      </SheetTrigger>
      <SheetContent className="data-[side=right]:w-full data-[side=right]:overflow-y-auto data-[side=right]:sm:max-w-xl">
        <SheetHeader className="pr-12">
          <SheetTitle>{panel.title}</SheetTitle>
          <SheetDescription>{panel.description}</SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-6">
          {!ownSession ? (
            <Notice tone="info">
              <p className="font-medium">
                {panel.notYours} ({openedByName})
              </p>
              <p>{panel.notYoursHint}</p>
            </Notice>
          ) : (
            <>
              {data ? (
                <div
                  role="group"
                  aria-label={copy.current.expected}
                  className="bg-muted/50 rounded-lg p-4"
                >
                  <p className="text-muted-foreground text-sm">{copy.current.expected}</p>
                  <p className="text-3xl font-semibold tabular-nums">
                    {formatMoney(data.expectedCents)}
                  </p>
                  <p className="text-muted-foreground text-xs">{copy.current.expectedHint}</p>
                </div>
              ) : null}

              <div
                role="tablist"
                aria-label={panel.tabs.label}
                className="bg-muted grid grid-cols-3 gap-1 rounded-lg p-1"
              >
                {TABS.map((name) => (
                  <button
                    key={name}
                    ref={(element) => {
                      tabRefs.current[name] = element;
                    }}
                    type="button"
                    role="tab"
                    id={`cash-tab-${name}`}
                    aria-selected={tab === name}
                    aria-controls={`cash-tabpanel-${name}`}
                    tabIndex={tab === name ? 0 : -1}
                    onClick={() => setTab(name)}
                    onKeyDown={onTabKeyDown}
                    className={cn(
                      "focus-visible:ring-ring/50 rounded-md px-2 py-1.5 text-sm font-medium outline-none focus-visible:ring-2",
                      tab === name
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {panel.tabs[name]}
                  </button>
                ))}
              </div>

              {state === null || (pending && !data) ? (
                <div role="status" aria-label={panel.loading} className="space-y-3">
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : "error" in state ? (
                <div className="space-y-3">
                  <Notice tone="error">{state.error || panel.failed}</Notice>
                  <Button type="button" variant="outline" loading={pending} onClick={load}>
                    {panel.retry}
                  </Button>
                </div>
              ) : (
                // Las tres secciones quedan montadas: cambiar de pestaña no borra lo que se estaba contando.
                TABS.map((name) => (
                  <div
                    key={name}
                    role="tabpanel"
                    id={`cash-tabpanel-${name}`}
                    aria-labelledby={`cash-tab-${name}`}
                    hidden={tab !== name}
                    className="space-y-4"
                  >
                    {name === "shift" ? (
                      <ShiftTab data={state.data} />
                    ) : name === "movements" ? (
                      <MovementsTab data={state.data} onChanged={load} />
                    ) : (
                      <CloseCashForm financeBox={state.data.financeCategories !== null} />
                    )}
                  </div>
                ))
              )}
            </>
          )}

          <Link
            href="/caja/cierres"
            className="text-primary inline-block text-sm underline underline-offset-4"
          >
            {panel.closings}
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ShiftTab({ data }: { data: CashPanelData }) {
  const { totals } = data;
  const cards = [
    { label: copy.current.float, value: formatMoney(totals.openingFloatCents) },
    { label: copy.current.cashSales, value: formatMoney(totals.cashPaymentsCents) },
    { label: copy.current.layawayCash, value: formatMoney(totals.layawayCashCents) },
    { label: copy.current.change, value: formatMoney(totals.changeGivenCents) },
    { label: copy.current.movementsIn, value: formatMoney(totals.movementsInCents) },
    { label: copy.current.movementsOut, value: formatMoney(totals.movementsOutCents) },
    { label: copy.current.cashRefunds, value: formatMoney(totals.cashRefundsCents) },
  ];
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        {data.terminalName} · {copy.current.openedAt} {formatLocalDateTime(new Date(data.openedAt))}
      </p>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {cards.map((card) => (
          <div key={card.label} className="space-y-0.5">
            <dt className="text-muted-foreground text-xs">{card.label}</dt>
            <dd className="font-medium tabular-nums">{card.value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-muted-foreground text-sm">
        {data.sales.count === 0
          ? copy.current.noSales
          : `${copy.current.sales}: ${data.sales.count} · ${formatMoney(data.sales.totalCents)}`}
      </p>
    </div>
  );
}

function MovementsTab({ data, onChanged }: { data: CashPanelData; onChanged: () => void }) {
  return (
    <div className="space-y-4">
      <CashMovementForm financeCategories={data.financeCategories} onSaved={onChanged} />
      {data.movements.length > 0 ? (
        <section aria-labelledby="panel-movements" className="space-y-2">
          <h3 id="panel-movements" className="text-base font-medium">
            {copy.movements.listTitle}
          </h3>
          <ul className="divide-y rounded-lg border text-sm">
            {data.movements.map((movement) => (
              <li key={movement.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3">
                <span className="text-muted-foreground">
                  {formatLocalDateTime(new Date(movement.createdAt))}
                </span>
                <span className="font-medium">{copy.movements[movement.type]}</span>
                <span className="tabular-nums">{formatMoney(movement.amountCents)}</span>
                <span className="text-muted-foreground">{movement.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="text-muted-foreground text-sm">{copy.movements.empty}</p>
      )}
    </div>
  );
}
