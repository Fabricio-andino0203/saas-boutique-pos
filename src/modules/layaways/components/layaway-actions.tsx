"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

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
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  addLayawayPaymentAction,
  cancelLayawayAction,
  settleLayawayAction,
} from "@/modules/layaways/actions";
import { LAYAWAY_PAYMENT_METHODS, type LayawayPaymentMethod } from "@/modules/layaways/schemas";

const copy = messages.layaways;

type LayawayActionsProps = {
  layawayId: string;
  number: string;
  balanceCents: number;
  /** Formas de pago que la tienda tiene activas. */
  enabledMethods: readonly string[];
  /** El cajero no cancela solo: necesita el usuario y el PIN de un gerente. */
  cancelNeedsManager: boolean;
  /** Puede cobrar el saldo (vender). */
  canSettle: boolean;
};

function MethodButtons({
  methods,
  value,
  onChange,
}: {
  methods: readonly LayawayPaymentMethod[];
  value: LayawayPaymentMethod;
  onChange: (method: LayawayPaymentMethod) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {methods.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className={cn(
            "focus-visible:ring-ring/50 h-10 rounded-lg border text-sm font-medium outline-none focus-visible:ring-3",
            value === option
              ? "border-primary bg-primary text-primary-foreground"
              : "hover:bg-muted",
          )}
        >
          {copy.methods[option]}
        </button>
      ))}
    </div>
  );
}

/** Lo que se puede hacer con un apartado activo: recibir un abono, saldarlo o cancelarlo. */
export function LayawayActions({
  layawayId,
  number,
  balanceCents,
  enabledMethods,
  cancelNeedsManager,
  canSettle,
}: LayawayActionsProps) {
  const methods = LAYAWAY_PAYMENT_METHODS.filter((method) => enabledMethods.includes(method));
  return (
    <div className="space-y-4">
      {balanceCents > 0 ? (
        <PayForm layawayId={layawayId} balanceCents={balanceCents} methods={methods} />
      ) : null}
      {canSettle ? (
        <SettleForm layawayId={layawayId} balanceCents={balanceCents} methods={methods} />
      ) : null}
      <CancelDialog layawayId={layawayId} number={number} needsManager={cancelNeedsManager} />
    </div>
  );
}

// ───────────── Abonar ─────────────

function PayForm({
  layawayId,
  balanceCents,
  methods,
}: {
  layawayId: string;
  balanceCents: number;
  methods: readonly LayawayPaymentMethod[];
}) {
  const router = useRouter();
  const t = copy.pay;
  // Se renueva después de cada abono: reintentar un envío fallido con el mismo valor no abona dos veces.
  const [requestId, setRequestId] = useState(() => newId());
  const [amountCents, setAmountCents] = useState<number | null>(null);
  const [method, setMethod] = useState<LayawayPaymentMethod>(methods[0] ?? "CASH");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ text: string; paymentId: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    setDone(null);
    if (!amountCents || amountCents <= 0) {
      setError(t.errors.amount);
      return;
    }
    if (amountCents > balanceCents) {
      setError(t.errors.tooMuch);
      return;
    }
    startTransition(async () => {
      const result = await addLayawayPaymentAction({
        clientRequestId: requestId,
        layawayId,
        payment: {
          method,
          amountCents,
          ...(reference.trim() ? { reference: reference.trim() } : {}),
        },
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setDone({
        text: `${t.done} ${formatMoney(result.balanceCents)}`,
        paymentId: result.paymentId,
      });
      setRequestId(newId());
      setAmountCents(null);
      setReference("");
      router.refresh();
    });
  }

  return (
    <form
      aria-labelledby="pay-title"
      className="bg-card space-y-3 rounded-lg border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <h3 id="pay-title" className="font-medium">
        {t.title}
      </h3>
      <MethodButtons methods={methods} value={method} onChange={setMethod} />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t.amount} htmlFor="layaway-pay-amount">
          <MoneyInput
            id="layaway-pay-amount"
            valueCents={amountCents}
            onValueChange={setAmountCents}
            selectOnFocus
          />
        </FormField>
        {method === "CASH" ? null : (
          <FormField label={t.reference} htmlFor="layaway-pay-reference">
            <Input
              id="layaway-pay-reference"
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
      {done ? (
        <p role="status" className="text-success flex flex-wrap items-center gap-3 text-sm">
          {done.text}
          <a
            href={`/imprimir/apartado/${done.paymentId}?auto=1`}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline underline-offset-4"
          >
            {t.printReceipt}
          </a>
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? t.submitting : t.submit}
      </Button>
    </form>
  );
}

// ───────────── Saldar ─────────────

type PaymentLine = { method: string; amountCents: number };

function SettleForm({
  layawayId,
  balanceCents,
  methods,
}: {
  layawayId: string;
  balanceCents: number;
  methods: readonly LayawayPaymentMethod[];
}) {
  const router = useRouter();
  const t = copy.settle;
  const [requestId] = useState(() => newId());
  const [method, setMethod] = useState<LayawayPaymentMethod>(methods[0] ?? "CASH");
  const [amountCents, setAmountCents] = useState<number | null>(
    balanceCents > 0 ? balanceCents : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{
    saleId: string;
    number: string;
    changeCents: number;
    fiscalNumber: string | null;
  } | null>(null);
  const [pending, startTransition] = useTransition();

  const payments: PaymentLine[] = balanceCents > 0 && amountCents ? [{ method, amountCents }] : [];
  const paid = payments.reduce((sum, p) => sum + p.amountCents, 0);
  const changeCents = method === "CASH" ? Math.max(0, paid - balanceCents) : 0;

  function submit() {
    setError(null);
    if (paid < balanceCents) {
      setError(t.errors.notEnough);
      return;
    }
    if (paid > balanceCents && method !== "CASH") {
      setError(messages.pos.charge.errors.noChange);
      return;
    }
    startTransition(async () => {
      const result = await settleLayawayAction({
        clientRequestId: requestId,
        layawayId,
        payments: payments.map((p) => ({
          method: p.method as LayawayPaymentMethod,
          amountCents: p.amountCents,
        })),
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setDone({
        saleId: result.sale.id,
        number: result.sale.number,
        changeCents: result.sale.changeCents,
        fiscalNumber: result.fiscalNumber,
      });
      router.refresh();
    });
  }

  if (done) {
    return (
      <section role="status" className="bg-card space-y-3 rounded-lg border p-4">
        <h3 className="text-lg font-semibold">{t.done.title}</h3>
        <p className="text-sm">
          {t.done.ticket} {done.number}
          {done.fiscalNumber ? ` · ${done.fiscalNumber}` : ""}
        </p>
        <div className="bg-muted rounded-lg px-4 py-3 text-center">
          <p className="text-muted-foreground text-sm">
            {done.changeCents > 0 ? t.done.change : t.done.noChange}
          </p>
          <p className="text-4xl font-bold tabular-nums">{formatMoney(done.changeCents)}</p>
        </div>
        <a
          href={`/imprimir/ticket/${done.saleId}?auto=1`}
          target="_blank"
          rel="noreferrer"
          className={buttonVariants({ variant: "outline" })}
        >
          {t.done.printTicket}
        </a>
      </section>
    );
  }

  return (
    <form
      aria-labelledby="settle-title"
      className="bg-card space-y-3 rounded-lg border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div>
        <h3 id="settle-title" className="font-medium">
          {t.title}
        </h3>
        <p className="text-muted-foreground text-sm">{t.description}</p>
      </div>
      <p className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-muted-foreground">{t.due}</span>
        <span className="text-2xl font-bold tabular-nums">{formatMoney(balanceCents)}</span>
      </p>
      {balanceCents > 0 ? (
        <>
          <MethodButtons methods={methods} value={method} onChange={setMethod} />
          <FormField label={t.amount} htmlFor="layaway-settle-amount">
            <MoneyInput
              id="layaway-settle-amount"
              valueCents={amountCents}
              onValueChange={setAmountCents}
              selectOnFocus
            />
          </FormField>
          {changeCents > 0 ? (
            <p role="status" className="text-success text-sm">
              {t.change}: <strong className="tabular-nums">{formatMoney(changeCents)}</strong>
            </p>
          ) : null}
        </>
      ) : (
        <p role="status" className="text-sm">
          {t.noPayment}
        </p>
      )}
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? t.submitting : t.submit}
      </Button>
    </form>
  );
}

// ───────────── Cancelar ─────────────

function CancelDialog({
  layawayId,
  number,
  needsManager,
}: {
  layawayId: string;
  number: string;
  needsManager: boolean;
}) {
  const [open, setOpen] = useState(false);
  const t = copy.cancel;
  return (
    <>
      <Button type="button" variant="destructive" onClick={() => setOpen(true)}>
        {t.button}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          {open ? (
            <CancelForm
              layawayId={layawayId}
              number={number}
              needsManager={needsManager}
              onClose={() => setOpen(false)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function CancelForm({
  layawayId,
  number,
  needsManager,
  onClose,
}: {
  layawayId: string;
  number: string;
  needsManager: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const t = copy.cancel;
  const [reason, setReason] = useState("");
  const [retainCents, setRetainCents] = useState<number | null>(null);
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [asked, setAsked] = useState(needsManager);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    if (reason.trim().length < 3) {
      setError(t.errors.reason);
      return;
    }
    startTransition(async () => {
      const result = await cancelLayawayAction({
        layawayId,
        reason,
        ...(retainCents ? { retainCents } : {}),
        ...(asked && username.trim() && pin ? { managerOverride: { username, pin } } : {}),
      });
      if (result.ok) {
        onClose();
        router.refresh();
        return;
      }
      if (result.code === "NEEDS_APPROVAL") {
        setAsked(true);
      }
      setError(result.message);
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {t.title} {number}
        </DialogTitle>
        <DialogDescription>{t.description}</DialogDescription>
      </DialogHeader>
      <FormField label={t.reason} htmlFor="cancel-reason">
        <Input
          id="cancel-reason"
          autoComplete="off"
          maxLength={200}
          placeholder={t.reasonPlaceholder}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </FormField>
      <FormField label={t.retain} htmlFor="cancel-retain" hint={t.retainHint}>
        <MoneyInput
          id="cancel-retain"
          valueCents={retainCents}
          onValueChange={setRetainCents}
          selectOnFocus
        />
      </FormField>
      {asked ? (
        <fieldset className="bg-warning/10 space-y-3 rounded-lg border p-3">
          <legend className="px-1 text-sm font-medium">{t.approval.title}</legend>
          <p className="text-sm">{t.approval.hint}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label={t.approval.username} htmlFor="cancel-username">
              <Input
                id="cancel-username"
                autoComplete="off"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </FormField>
            <FormField label={t.approval.pin} htmlFor="cancel-pin">
              <Input
                id="cancel-pin"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={6}
                value={pin}
                onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
              />
            </FormField>
          </div>
        </fieldset>
      ) : null}
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>
          {t.back}
        </Button>
        <Button type="button" variant="destructive" disabled={pending} onClick={submit}>
          {pending ? t.submitting : t.submit}
        </Button>
      </div>
    </>
  );
}
