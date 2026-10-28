"use client";

import { useEffect, useState, useTransition } from "react";

import { FormField } from "@/components/shared/form-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { messages } from "@/config/messages.es";
import { formatLocalDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { summarizeCart } from "@/modules/sales/cart-logic";
import type { ParkedCart } from "@/modules/sales/cart-store";
import { quickCustomerAction, searchCustomersAction } from "@/modules/sales/pos-actions";
import type { PosConfig, QuickCustomer } from "@/modules/sales/pos-types";

/* ───────────── Cliente rápido ───────────── */

const customerCopy = messages.pos.customer;

type CustomerDialogProps = {
  open: boolean;
  current: QuickCustomer | null;
  onSelect: (customer: QuickCustomer | null) => void;
  onClose: () => void;
};

export function CustomerDialog(props: CustomerDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent>{props.open ? <CustomerForm {...props} /> : null}</DialogContent>
    </Dialog>
  );
}

function CustomerForm({ current, onSelect, onClose }: CustomerDialogProps) {
  const [name, setName] = useState(current?.name ?? "");
  const [phone, setPhone] = useState(current?.phone ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [term, setTerm] = useState("");
  const [matches, setMatches] = useState<QuickCustomer[] | null>(null);

  // Busca entre los clientes que ya existen mientras se escribe (con una pausa corta).
  useEffect(() => {
    if (term.trim().length < 2) {
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await searchCustomersAction(term);
      if (!cancelled) {
        setMatches("error" in result ? [] : result.customers);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [term]);
  const shown = term.trim().length >= 2 ? matches : null;

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await quickCustomerAction({ name, phone });
      if ("error" in result) {
        setError(result.error);
      } else {
        onSelect(result.customer);
      }
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{customerCopy.title}</DialogTitle>
        <DialogDescription>{customerCopy.description}</DialogDescription>
      </DialogHeader>
      <FormField label={customerCopy.searchLabel} htmlFor="customer-search">
        <Input
          id="customer-search"
          autoFocus
          autoComplete="off"
          placeholder={customerCopy.searchPlaceholder}
          value={term}
          onChange={(event) => setTerm(event.target.value)}
        />
      </FormField>
      {shown !== null ? (
        shown.length > 0 ? (
          <ul aria-label={customerCopy.searchLabel} className="divide-y rounded-lg border text-sm">
            {shown.map((candidate) => (
              <li key={candidate.id}>
                <button
                  type="button"
                  onClick={() => onSelect(candidate)}
                  className="hover:bg-muted focus-visible:ring-ring/50 flex w-full items-center justify-between gap-2 px-3 py-2 text-left outline-none focus-visible:ring-3"
                >
                  <span className="font-medium">{candidate.name}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {candidate.phone ?? ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p role="status" className="text-muted-foreground text-sm">
            {customerCopy.noMatches}
          </p>
        )
      ) : null}
      <p className="text-muted-foreground border-t pt-3 text-sm font-medium">
        {customerCopy.createNew}
      </p>
      <FormField label={customerCopy.name} htmlFor="customer-name">
        <Input
          id="customer-name"
          autoComplete="off"
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </FormField>
      <FormField label={customerCopy.phone} htmlFor="customer-phone" hint={customerCopy.phoneHint}>
        <Input
          id="customer-phone"
          inputMode="tel"
          autoComplete="off"
          maxLength={20}
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              save();
            }
          }}
        />
      </FormField>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        {current ? (
          <Button type="button" variant="outline" onClick={() => onSelect(null)}>
            {customerCopy.remove}
          </Button>
        ) : null}
        <Button type="button" disabled={pending} onClick={save}>
          {pending ? customerCopy.saving : customerCopy.save}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          {messages.common.close}
        </Button>
      </div>
    </>
  );
}

/* ───────────── Ventas en espera ───────────── */

const parkedCopy = messages.pos.parked;

type ParkedDialogProps = {
  open: boolean;
  parked: ParkedCart[];
  hasCurrent: boolean;
  config: PosConfig;
  onPark: () => void;
  onResume: (id: string) => void;
  onDiscard: (id: string) => void;
  onClose: () => void;
};

export function ParkedDialog({
  open,
  parked,
  hasCurrent,
  config,
  onPark,
  onResume,
  onDiscard,
  onClose,
}: ParkedDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{parkedCopy.title}</DialogTitle>
          <DialogDescription>{parkedCopy.description}</DialogDescription>
        </DialogHeader>
        {hasCurrent ? (
          <Button type="button" onClick={onPark}>
            {parkedCopy.parkCurrent}
          </Button>
        ) : null}
        {parked.length === 0 ? (
          <p className="text-muted-foreground text-sm">{parkedCopy.empty}</p>
        ) : (
          <ul className="space-y-2">
            {parked.map((entry) => {
              const summary = summarizeCart(entry.items, entry.discount, config);
              return (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                >
                  <div className="min-w-0 text-sm">
                    <p className="font-medium">
                      {entry.customer?.name ?? messages.pos.ticket.customerNone}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {formatLocalDateTime(new Date(entry.createdAt))} · {summary.units}{" "}
                      {parkedCopy.units} ·{" "}
                      <span className="tabular-nums">
                        {formatMoney(summary.priced?.totalCents ?? summary.grossCents)}
                      </span>
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" onClick={() => onResume(entry.id)}>
                      {parkedCopy.resume}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => onDiscard(entry.id)}
                    >
                      {parkedCopy.discard}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ───────────── Atajos ───────────── */

const helpCopy = messages.pos.help;

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{helpCopy.title}</DialogTitle>
          <DialogDescription>{messages.pos.search.label}</DialogDescription>
        </DialogHeader>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted-foreground border-b text-left">
              <th className="py-1.5 pr-4 font-medium">{helpCopy.key}</th>
              <th className="py-1.5 font-medium">{helpCopy.action}</th>
            </tr>
          </thead>
          <tbody>
            {helpCopy.rows.map(([key, action]) => (
              <tr key={key} className="border-b last:border-0">
                <td className="py-1.5 pr-4">
                  <kbd className="bg-muted rounded border px-1.5 py-0.5 text-xs font-medium">
                    {key}
                  </kbd>
                </td>
                <td className="py-1.5">{action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DialogContent>
    </Dialog>
  );
}
