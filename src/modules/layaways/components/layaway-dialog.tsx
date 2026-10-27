"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";

import { FormField } from "@/components/shared/form-field";
import { MoneyInput } from "@/components/shared/money-input";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { messages } from "@/config/messages.es";
import { newId } from "@/lib/client-id";
import { formatLocalDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { percentOf } from "@/lib/money";
import { cn } from "@/lib/utils";
import { createLayawayAction } from "@/modules/layaways/actions";
import { LAYAWAY_PAYMENT_METHODS, type LayawayPaymentMethod } from "@/modules/layaways/schemas";
import type { CartSummary } from "@/modules/sales/cart-logic";
import { usePosStore } from "@/modules/sales/cart-store";
import type { PosConfig } from "@/modules/sales/pos-types";

const copy = messages.layaways.create;

type Created = {
  id: string;
  number: string;
  paidCents: number;
  balanceCents: number;
  expiresAt: string;
  paymentId: string;
};

type LayawayDialogProps = {
  open: boolean;
  summary: CartSummary;
  config: PosConfig;
  onClose: () => void;
};

/** Convierte el ticket en un apartado: reserva las prendas y recibe el primer abono. */
export function LayawayDialog({ open, summary, config, onClose }: LayawayDialogProps) {
  // Mientras se envía no se deja cerrar: así no se pierde el resultado.
  const busyRef = useRef(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busyRef.current) {
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        {open ? (
          <LayawayForm summary={summary} config={config} busyRef={busyRef} onClose={onClose} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function LayawayForm({
  summary,
  config,
  busyRef,
  onClose,
}: Omit<LayawayDialogProps, "open"> & { busyRef: { current: boolean } }) {
  const items = usePosStore((state) => state.items);
  const customer = usePosStore((state) => state.customer);
  // Se genera una vez por apartado: reintentar el envío con él no lo duplica.
  const [requestId] = useState(() => newId());

  const total = summary.priced?.totalCents ?? 0;
  const minDeposit = percentOf(total, config.layaway.minDepositPercent * 100);
  const methods = LAYAWAY_PAYMENT_METHODS.filter((method) =>
    config.enabledPaymentMethods.includes(method),
  );

  const [amountCents, setAmountCents] = useState<number | null>(minDeposit > 0 ? minDeposit : null);
  const [method, setMethod] = useState<LayawayPaymentMethod>(methods[0] ?? "CASH");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    if (items.length === 0 || total <= 0) {
      setError(copy.errors.empty);
      return;
    }
    if (!customer) {
      setError(copy.errors.customer);
      return;
    }
    if (!amountCents || amountCents <= 0) {
      setError(copy.errors.amount);
      return;
    }
    if (amountCents < minDeposit) {
      setError(`${copy.errors.tooLow} ${formatMoney(minDeposit)}.`);
      return;
    }
    if (amountCents > total) {
      setError(copy.errors.tooHigh);
      return;
    }
    busyRef.current = true;
    startTransition(async () => {
      const result = await createLayawayAction({
        clientRequestId: requestId,
        customerId: customer.id,
        lines: items.map((item) => ({ variantId: item.variantId, quantity: item.quantity })),
        deposit: {
          method,
          amountCents,
          ...(reference.trim() ? { reference: reference.trim() } : {}),
        },
      });
      busyRef.current = false;
      if (result.ok) {
        usePosStore.getState().clearCart();
        setCreated(result.layaway);
        return;
      }
      setError(result.message);
    });
  }

  if (created) {
    const done = copy.done;
    return (
      <>
        <DialogHeader>
          <DialogTitle>{done.title}</DialogTitle>
          <DialogDescription>
            {done.number} {created.number} · {copy.expires}{" "}
            {formatLocalDateTime(new Date(created.expiresAt))}
          </DialogDescription>
        </DialogHeader>
        <div role="status" className="bg-muted space-y-1 rounded-lg px-4 py-4 text-center">
          <p className="text-muted-foreground text-sm">{done.balance}</p>
          <p className="text-4xl font-bold tabular-nums">{formatMoney(created.balanceCents)}</p>
          <p className="text-muted-foreground text-sm tabular-nums">
            {done.deposit} {formatMoney(created.paidCents)}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <a
            href={`/imprimir/apartado/${created.paymentId}?auto=1`}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ variant: "outline" })}
          >
            {done.printReceipt}
          </a>
          <Link
            href={`/apartados/${created.id}`}
            className={buttonVariants({ variant: "outline" })}
          >
            {done.view}
          </Link>
          <Button type="button" autoFocus onClick={onClose}>
            {done.keepSelling}
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogDescription>{copy.description}</DialogDescription>
      </DialogHeader>

      <dl className="bg-muted space-y-1 rounded-lg px-4 py-3 text-sm">
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">{copy.customer}</dt>
          <dd className="font-medium">{customer?.name ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">{copy.total}</dt>
          <dd className="text-xl font-bold tabular-nums">{formatMoney(total)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">{copy.minDeposit}</dt>
          <dd className="font-medium tabular-nums">
            {formatMoney(minDeposit)} ({config.layaway.minDepositPercent} %)
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">{copy.expires}</dt>
          <dd>
            {copy.expiresIn} {config.layaway.expiryDays} {copy.days}
          </dd>
        </div>
      </dl>

      {!customer ? (
        <p role="status" className="text-warning text-sm">
          {copy.noCustomer}
        </p>
      ) : null}

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">{copy.method}</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {methods.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={method === option}
              onClick={() => setMethod(option)}
              className={cn(
                "focus-visible:ring-ring/50 h-11 rounded-lg border text-sm font-medium outline-none focus-visible:ring-3",
                method === option
                  ? "border-primary bg-primary text-primary-foreground"
                  : "hover:bg-muted",
              )}
            >
              {messages.layaways.methods[option]}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={copy.deposit} htmlFor="layaway-deposit">
          <MoneyInput
            id="layaway-deposit"
            autoFocus
            selectOnFocus
            valueCents={amountCents}
            onValueChange={setAmountCents}
            onEnter={submit}
            className="h-11 text-xl font-semibold"
          />
        </FormField>
        {method === "CASH" ? null : (
          <FormField label={copy.reference} htmlFor="layaway-reference" hint={copy.referenceHint}>
            <Input
              id="layaway-reference"
              autoComplete="off"
              maxLength={60}
              value={reference}
              onChange={(event) => setReference(event.target.value)}
            />
          </FormField>
        )}
      </div>

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>
          {copy.back}
        </Button>
        <Button
          type="button"
          className="h-12 min-w-40 text-lg font-semibold"
          disabled={pending}
          onClick={submit}
        >
          {pending ? copy.submitting : copy.submit}
        </Button>
      </div>
    </>
  );
}
