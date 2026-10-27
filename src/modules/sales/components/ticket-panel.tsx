"use client";

import { Minus, Plus, Trash2, UserRound, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { messages } from "@/config/messages.es";
import { formatMoney, formatPercentBps } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CartItem, CartSummary } from "@/modules/sales/cart-logic";
import type { PosConfig, QuickCustomer } from "@/modules/sales/pos-types";

const copy = messages.pos;

/** La cantidad se escribe a mano y se confirma al salir del campo o con Enter. */
function QuantityField({
  item,
  onChange,
}: {
  item: CartItem;
  onChange: (quantity: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null) {
      const parsed = Number(draft);
      if (draft.trim() !== "" && Number.isFinite(parsed)) {
        onChange(parsed);
      }
      setDraft(null);
    }
  };
  return (
    <input
      inputMode="numeric"
      autoComplete="off"
      aria-label={`${copy.ticket.quantity} ${item.productName} ${item.variantLabel}`.trim()}
      value={draft ?? String(item.quantity)}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setDraft(event.target.value.replace(/\D/g, "").slice(0, 4))}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
      }}
      className="border-input bg-background focus-visible:ring-ring/50 h-11 w-14 rounded-lg border text-center text-lg font-semibold tabular-nums outline-none focus-visible:ring-3"
    />
  );
}

type TicketPanelProps = {
  items: CartItem[];
  summary: CartSummary;
  config: PosConfig;
  selectedId: string | null;
  customer: QuickCustomer | null;
  onSelect: (id: string) => void;
  onQuantity: (id: string, quantity: number) => void;
  onRemove: (id: string) => void;
  onDiscount: () => void;
  onCustomer: () => void;
  onCharge: () => void;
  onClear: () => void;
};

/** El ticket: las líneas, los totales y el botón de cobrar. El total siempre grande y a la vista. */
export function TicketPanel({
  items,
  summary,
  config,
  selectedId,
  customer,
  onSelect,
  onQuantity,
  onRemove,
  onDiscount,
  onCustomer,
  onCharge,
  onClear,
}: TicketPanelProps) {
  const { priced } = summary;
  const ticket = copy.ticket;
  const taxLabel = `${config.pricesIncludeTax ? ticket.taxIncluded : ticket.taxAdded} (${formatPercentBps(config.taxRateBps)} %)`;

  return (
    <section
      aria-labelledby="ticket-title"
      className="bg-card flex min-h-0 flex-col rounded-lg border lg:h-full"
    >
      <header className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div className="min-w-0">
          <h2 id="ticket-title" className="font-semibold">
            {ticket.title}
          </h2>
          <p className="text-muted-foreground text-xs">
            {summary.units} {ticket.units}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onCustomer}>
          <UserRound aria-hidden="true" />
          <span className="max-w-32 truncate">
            {customer ? customer.name : ticket.customerNone}
          </span>
        </Button>
      </header>

      <div className="min-h-40 flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <p className="text-muted-foreground p-6 text-center text-sm">{ticket.empty}</p>
        ) : (
          <ul className="space-y-2 p-3">
            {items.map((item, index) => {
              const line = priced?.lines[index];
              const selected = item.id === selectedId;
              return (
                <li
                  key={item.id}
                  className={cn(
                    "rounded-lg border p-2.5",
                    selected ? "border-primary bg-primary/5" : "border-border",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => onSelect(item.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block truncate font-medium">{item.productName}</span>
                      {item.variantLabel ? (
                        <span className="text-muted-foreground block truncate text-xs">
                          {item.variantLabel}
                        </span>
                      ) : null}
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`${ticket.remove}: ${item.productName} ${item.variantLabel}`.trim()}
                      onClick={() => onRemove(item.id)}
                    >
                      <X aria-hidden="true" />
                    </Button>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        className="size-11"
                        aria-label={`${ticket.decrease}: ${item.productName}`}
                        onClick={() => onQuantity(item.id, item.quantity - 1)}
                      >
                        <Minus aria-hidden="true" />
                      </Button>
                      <QuantityField
                        item={item}
                        onChange={(quantity) => onQuantity(item.id, quantity)}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        className="size-11"
                        aria-label={`${ticket.increase}: ${item.productName}`}
                        onClick={() => onQuantity(item.id, item.quantity + 1)}
                      >
                        <Plus aria-hidden="true" />
                      </Button>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold tabular-nums">
                        {line
                          ? formatMoney(line.lineTotalCents)
                          : formatMoney(item.unitPriceCents * item.quantity)}
                      </p>
                      <p className="text-muted-foreground text-xs tabular-nums">
                        {item.quantity} × {formatMoney(item.unitPriceCents)}
                      </p>
                      {line && line.ownDiscountCents > 0 ? (
                        <p className="text-success text-xs tabular-nums">
                          {ticket.lineDiscount} −{formatMoney(line.ownDiscountCents)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <footer className="space-y-2 border-t p-3">
        {summary.invalidDiscount ? (
          <p role="alert" className="text-destructive text-sm">
            {ticket.invalidDiscount}
          </p>
        ) : null}
        <dl className="space-y-0.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{ticket.subtotal}</dt>
            <dd className="tabular-nums">{formatMoney(summary.grossCents)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{ticket.discount}</dt>
            <dd className={cn("tabular-nums", summary.discountCents > 0 && "text-success")}>
              {summary.discountCents > 0 ? "−" : ""}
              {formatMoney(summary.discountCents)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{taxLabel}</dt>
            <dd className="tabular-nums">{formatMoney(priced?.taxCents ?? 0)}</dd>
          </div>
        </dl>
        <div
          role="group"
          aria-label={ticket.total}
          className="bg-muted flex items-baseline justify-between rounded-lg px-4 py-2"
        >
          <span className="text-lg font-semibold">{ticket.total}</span>
          <span className="text-3xl leading-tight font-bold tabular-nums">
            {formatMoney(priced?.totalCents ?? 0)}
          </span>
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Button type="button" variant="outline" className="h-10" onClick={onDiscount}>
            {copy.actions.discount} <kbd className="text-muted-foreground ml-1 text-xs">F4</kbd>
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-10"
            disabled={items.length === 0}
            onClick={onClear}
          >
            <Trash2 aria-hidden="true" />
            {ticket.clear}
          </Button>
        </div>
        <Button
          type="button"
          className="h-12 w-full text-lg font-semibold"
          disabled={!priced}
          onClick={onCharge}
        >
          {copy.actions.charge} <kbd className="ml-2 text-sm opacity-80">F12</kbd>
        </Button>
      </footer>
    </section>
  );
}
