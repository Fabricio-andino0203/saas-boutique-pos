"use client";

import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Ban,
  Banknote,
  Bookmark,
  ChevronLeft,
  Receipt,
  Scissors,
} from "lucide-react";
import Link from "next/link";
import { useState, useTransition, type ComponentProps, type ReactNode } from "react";
import { toast } from "sonner";

import { Notice } from "@/components/shared/notice";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { messages } from "@/config/messages.es";
import { formatLocalDateTime } from "@/lib/dates";
import { formatMoney, pluralize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { loadCashPanelAction } from "@/modules/cash/actions";
import { CashMovementForm, type MovementKind } from "@/modules/cash/components/cash-movement-form";
import { CloseCashForm } from "@/modules/cash/components/close-cash-form";
import type { CashPanelData, CashPanelState } from "@/modules/cash/types";

const copy = messages.cash;
const panel = copy.panel;

type View = "menu" | MovementKind | "close";

type CashPanelProps = {
  /** La caja abierta de la terminal es de quien está en pantalla; si no, el panel solo lo explica. */
  ownSession: boolean;
  /** Quién abrió la caja de la terminal (para explicarlo cuando no es quien está en pantalla). */
  openedByName: string;
  /** El punto de venta pausa sus atajos mientras el panel está abierto. */
  onOpenChange?: (open: boolean) => void;
  /** Hay prendas en el ticket: se puede cancelar la venta. */
  canCancelSale: boolean;
  onCancelSale: () => void;
  /** Solo si la persona puede manejar apartados. */
  canLayaway: boolean;
};

const actionClass = "h-12 justify-start gap-2 px-3 text-sm font-medium";

/**
 * La caja dentro de Vender, como los botones de una caja registradora: ingresar o retirar efectivo, agregar un gasto, los
 * apartados, cancelar la venta y el corte. Los datos se piden al abrir y otra vez tras cada cambio, así lo que ven coincide
 * con las ventas que se acaban de cobrar. (Cambiar de cajero sigue en el encabezado de Vender: también lo usa quien no
 * es dueño del turno.)
 */
export function CashPanel({
  ownSession,
  openedByName,
  onOpenChange,
  canCancelSale,
  onCancelSale,
  canLayaway,
}: CashPanelProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("menu");
  const [state, setState] = useState<CashPanelState | null>(null);
  const [pending, startTransition] = useTransition();

  function load() {
    startTransition(async () => {
      setState(await loadCashPanelAction());
    });
  }

  function changeOpen(next: boolean) {
    setOpen(next);
    onOpenChange?.(next);
    if (next) {
      setView("menu");
      setState(null);
      if (ownSession) {
        load();
      }
    }
  }

  /** Cierra el panel y deja que el punto de venta siga con lo que pidió (cancelar la venta). */
  function leaveTo(action: () => void) {
    changeOpen(false);
    action();
  }

  function saved() {
    toast.success(copy.movements.saved);
    setView("menu");
    load();
  }

  const data = state && "data" in state ? state.data : null;
  const heading =
    view === "close" ? copy.close.title : view === "menu" ? null : copy.movements.forms[view];

  return (
    <Sheet open={open} onOpenChange={changeOpen}>
      <SheetTrigger render={<Button type="button" variant="outline" />}>
        <Banknote aria-hidden="true" />
        {messages.pos.actions.cash}
      </SheetTrigger>
      <SheetContent className="data-[side=right]:w-full data-[side=right]:overflow-y-auto data-[side=right]:sm:max-w-xl">
        <SheetHeader className="pr-12">
          <SheetTitle>{panel.title}</SheetTitle>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-6">
          {!ownSession ? (
            <Notice tone="info">
              <p className="font-medium">
                {panel.notYours} ({openedByName})
              </p>
              <p>{panel.notYoursHint}</p>
            </Notice>
          ) : state === null || (pending && !data) ? (
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
            <>
              <div
                role="group"
                aria-label={copy.current.expected}
                className="bg-muted/50 rounded-lg p-4"
              >
                <p className="text-muted-foreground text-sm">{copy.current.expected}</p>
                <p className="text-3xl font-semibold tabular-nums">
                  {formatMoney(state.data.expectedCents)}
                </p>
              </div>

              {heading ? (
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-11"
                    aria-label={panel.back}
                    onClick={() => setView("menu")}
                  >
                    <ChevronLeft aria-hidden="true" />
                  </Button>
                  <h2 className="text-lg font-medium">{heading}</h2>
                </div>
              ) : null}

              <div hidden={view !== "menu"} className="space-y-4">
                <ActionGrid
                  data={state.data}
                  canCancelSale={canCancelSale}
                  canLayaway={canLayaway}
                  onView={setView}
                  onCancelSale={() => leaveTo(onCancelSale)}
                />
                <ShiftDetail data={state.data} />
                <Link
                  href="/caja/cierres"
                  className="text-primary inline-block text-sm underline underline-offset-4"
                >
                  {panel.closings}
                </Link>
              </div>

              {view === "in" || view === "out" || view === "expense" ? (
                <CashMovementForm
                  key={view}
                  kind={view}
                  financeCategories={state.data.financeCategories}
                  onSaved={saved}
                />
              ) : null}

              {/* El corte queda montado: volver al menú no borra lo que se estaba contando. */}
              <div hidden={view !== "close"}>
                <CloseCashForm financeBox={state.data.financeCategories !== null} />
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ActionButton({
  icon,
  children,
  ...props
}: { icon: ReactNode } & Omit<ComponentProps<typeof Button>, "variant" | "size">) {
  return (
    <Button type="button" variant="outline" className={actionClass} {...props}>
      {icon}
      {children}
    </Button>
  );
}

function ActionGrid({
  data,
  canCancelSale,
  canLayaway,
  onView,
  onCancelSale,
}: {
  data: CashPanelData;
  canCancelSale: boolean;
  canLayaway: boolean;
  onView: (view: View) => void;
  onCancelSale: () => void;
}) {
  const actions = panel.actions;
  // Sin el módulo Finanzas, «Retirar efectivo» cubre también los pagos: el gasto necesita una categoría a dónde ir.
  const canExpense = data.financeCategories?.some((category) => category.type === "EXPENSE");
  return (
    <div role="group" aria-label={actions.label} className="grid grid-cols-2 gap-2">
      <ActionButton icon={<ArrowDownToLine aria-hidden="true" />} onClick={() => onView("in")}>
        {actions.cashIn}
      </ActionButton>
      <ActionButton icon={<ArrowUpFromLine aria-hidden="true" />} onClick={() => onView("out")}>
        {actions.cashOut}
      </ActionButton>
      {canExpense ? (
        <ActionButton icon={<Receipt aria-hidden="true" />} onClick={() => onView("expense")}>
          {actions.expense}
        </ActionButton>
      ) : null}
      {canLayaway ? (
        <Link href="/apartados" className={cn(buttonVariants({ variant: "outline" }), actionClass)}>
          <Bookmark aria-hidden="true" />
          {actions.layaways}
        </Link>
      ) : null}
      <ActionButton
        icon={<Ban aria-hidden="true" />}
        disabled={!canCancelSale}
        onClick={onCancelSale}
      >
        {actions.cancelSale}
      </ActionButton>
      <Button
        type="button"
        className={cn(actionClass, "col-span-2")}
        onClick={() => onView("close")}
      >
        <Scissors aria-hidden="true" />
        {actions.close}
      </Button>
    </div>
  );
}

function ShiftDetail({ data }: { data: CashPanelData }) {
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
        {data.terminalName} · {formatLocalDateTime(new Date(data.openedAt))}
        {data.sales.count > 0
          ? ` · ${data.sales.count} ${pluralize(data.sales.count, copy.current.saleOne, copy.current.sales).toLowerCase()} · ${formatMoney(data.sales.totalCents)}`
          : ""}
      </p>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {cards.map((card) => (
          <div key={card.label} className="space-y-0.5">
            <dt className="text-muted-foreground text-sm">{card.label}</dt>
            <dd className="font-medium tabular-nums">{card.value}</dd>
          </div>
        ))}
      </dl>
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
      ) : null}
    </div>
  );
}
