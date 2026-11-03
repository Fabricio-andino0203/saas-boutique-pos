"use client";

import { Banknote, CreditCard, Landmark, Ticket, Wallet, X, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";

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
import { Notice } from "@/components/shared/notice";
import { SuccessCheck } from "@/components/shared/success-check";
import { messages } from "@/config/messages.es";
import { formatMoney } from "@/lib/format";
import { sumCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { processExchangeAction } from "@/modules/returns/actions";
import type { RefundChoice } from "@/modules/returns/schemas";
import { settlePayments } from "@/modules/sales/calc";
import type { CartSummary } from "@/modules/sales/cart-logic";
import { usePosStore } from "@/modules/sales/cart-store";
import { completeSaleAction } from "@/modules/sales/actions";
import type { PosConfig, SoldExchange, SoldSale } from "@/modules/sales/pos-types";
import type { SalePaymentMethod } from "@/modules/sales/schemas";

const copy = messages.pos.charge;
const exchangeCopy = messages.returns.exchange;

const METHOD_ICON: Record<SalePaymentMethod, LucideIcon> = {
  CASH: Banknote,
  CARD: CreditCard,
  TRANSFER: Landmark,
  OTHER: Wallet,
  STORE_CREDIT: Ticket,
};
const METHOD_ORDER: readonly SalePaymentMethod[] = [
  "CASH",
  "CARD",
  "TRANSFER",
  "OTHER",
  "STORE_CREDIT",
];
/** Billetes de uso diario para cobrar rápido en efectivo (en centavos). */
const QUICK_BILLS = [10000, 20000, 50000, 100000] as const;

type PaymentDraft = { method: SalePaymentMethod; amountCents: number; reference?: string };

type ChargeDialogProps = {
  open: boolean;
  summary: CartSummary;
  config: PosConfig;
  /** El saldo de crédito de tienda del cliente del ticket (0 si no hay cliente). */
  creditCents: number;
  /** Se llama al cerrar el diálogo (con o sin venta). */
  onClose: () => void;
};

export function ChargeDialog({ open, summary, config, creditCents, onClose }: ChargeDialogProps) {
  // Mientras se envía el cobro no se deja cerrar: así no se pierde el resultado.
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
      <DialogContent className="sm:max-w-xl">
        {open ? (
          <ChargeForm
            summary={summary}
            config={config}
            creditCents={creditCents}
            busyRef={busyRef}
            onClose={onClose}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ChargeForm({
  summary,
  config,
  creditCents,
  busyRef,
  onClose,
}: Omit<ChargeDialogProps, "open"> & { busyRef: { current: boolean } }) {
  const items = usePosStore((state) => state.items);
  const discount = usePosStore((state) => state.discount);
  const customer = usePosStore((state) => state.customer);
  const clientRequestId = usePosStore((state) => state.clientRequestId);
  const exchange = usePosStore((state) => state.exchange);

  const total = summary.priced?.totalCents ?? 0;
  // En un cambio, lo devuelto paga primero: solo se cobra la diferencia y, si sobra, se le devuelve.
  const credit = exchange?.valueCents ?? 0;
  const payable = Math.max(0, total - credit);
  const leftover = Math.max(0, credit - total);
  const canUseCredit = customer !== null && creditCents > 0;
  const methods = METHOD_ORDER.filter((option) =>
    option === "STORE_CREDIT" ? canUseCredit : config.enabledPaymentMethods.includes(option),
  );

  const [lines, setLines] = useState<PaymentDraft[]>([]);
  const [method, setMethod] = useState<SalePaymentMethod>(methods[0] ?? "CASH");
  const [amountCents, setAmountCents] = useState<number | null>(payable > 0 ? payable : null);
  const [reference, setReference] = useState("");
  const [invoice, setInvoice] = useState(false);
  const [taxId, setTaxId] = useState("");
  const [invoiceName, setInvoiceName] = useState(customer?.name ?? "");
  const [needsApproval, setNeedsApproval] = useState(false);
  const [override, setOverride] = useState({ username: "", pin: "" });
  const [error, setError] = useState<string | null>(null);
  const [sold, setSold] = useState<SoldSale | null>(null);
  const [soldExchange, setSoldExchange] = useState<SoldExchange | null>(null);
  const [leftoverMethod, setLeftoverMethod] = useState<RefundChoice>(
    exchange?.refundMethod ?? "STORE_CREDIT",
  );
  const [pending, startTransition] = useTransition();

  const addedCents = sumCents(lines.map((line) => line.amountCents));
  const draftCents = amountCents ?? 0;
  const effective: PaymentDraft[] =
    draftCents > 0
      ? [...lines, { method, amountCents: draftCents, reference: reference.trim() || undefined }]
      : lines;
  const paidCents = sumCents(effective.map((line) => line.amountCents));
  const remainingCents = Math.max(0, payable - paidCents);
  const creditUsedCents = sumCents(
    effective.filter((line) => line.method === "STORE_CREDIT").map((line) => line.amountCents),
  );
  const creditLeftCents = Math.max(
    0,
    creditCents -
      sumCents(
        lines.filter((line) => line.method === "STORE_CREDIT").map((line) => line.amountCents),
      ),
  );
  let changeCents = 0;
  let covers = false;
  try {
    changeCents = settlePayments(payable, effective).changeCents;
    covers = true;
  } catch {
    covers = false;
  }

  function chooseMethod(next: SalePaymentMethod) {
    setMethod(next);
    const pending = Math.max(0, payable - addedCents);
    setAmountCents(
      (next === "STORE_CREDIT" ? Math.min(pending, creditLeftCents) : pending) || null,
    );
    setReference("");
  }

  function addPayment() {
    if (draftCents <= 0) {
      return;
    }
    setLines([...lines, effective[effective.length - 1] as PaymentDraft]);
    setAmountCents(remainingCents > 0 ? remainingCents : null);
    setReference("");
  }

  function submit() {
    setError(null);
    if (!covers) {
      setError(paidCents < payable ? copy.errors.notEnough : copy.errors.noChange);
      return;
    }
    if (creditUsedCents > creditCents) {
      setError(copy.errors.creditExceeded);
      return;
    }
    if (exchange && leftover > 0 && leftoverMethod === "STORE_CREDIT" && !customer) {
      setError(exchangeCopy.customerNeeded);
      return;
    }
    busyRef.current = true;
    startTransition(async () => {
      const shared = {
        lines: items.map((item) => ({
          variantId: item.variantId,
          quantity: item.quantity,
          ...(item.discount ? { discount: item.discount } : {}),
        })),
        ...(discount ? { discount } : {}),
        payments: effective.map((payment) => ({
          method: payment.method,
          amountCents: payment.amountCents,
          ...(payment.reference ? { reference: payment.reference } : {}),
        })),
        ...(customer ? { customerId: customer.id } : {}),
        ...(invoice ? { invoice: { taxId, name: invoiceName } } : {}),
        ...(needsApproval && override.username.trim() && override.pin
          ? { managerOverride: { username: override.username, pin: override.pin } }
          : {}),
      };
      if (exchange) {
        const outcome = await processExchangeAction({
          clientRequestId: exchange.requestId,
          saleId: exchange.saleId,
          items: exchange.items,
          reason: exchange.reason,
          newLines: shared.lines,
          ...(shared.discount ? { discount: shared.discount } : {}),
          payments: shared.payments,
          ...(leftover > 0 ? { refundMethod: leftoverMethod } : {}),
          ...(shared.customerId ? { customerId: shared.customerId } : {}),
          ...(shared.invoice ? { invoice: shared.invoice } : {}),
          ...(shared.managerOverride ? { managerOverride: shared.managerOverride } : {}),
        });
        busyRef.current = false;
        if (outcome.ok) {
          usePosStore.getState().finishExchange(outcome.sale.id);
          setSoldExchange({
            doc: outcome.doc,
            creditAppliedCents: outcome.sale.creditAppliedCents,
          });
          setSold(outcome.sale);
          return;
        }
        if (outcome.code === "NEEDS_APPROVAL") {
          setNeedsApproval(true);
        }
        setError(outcome.message);
        return;
      }
      const result = await completeSaleAction({ clientRequestId, ...shared });
      busyRef.current = false;
      if (result.ok) {
        const store = usePosStore.getState();
        store.setLastSale(result.sale.id);
        store.clearCart();
        setSold(result.sale);
        return;
      }
      if (result.code === "NEEDS_APPROVAL") {
        setNeedsApproval(true);
      }
      setError(result.message);
    });
  }

  // Enter en el monto cobra: el controlador se lee del último render.
  const submitRef = useRef(submit);
  useEffect(() => {
    submitRef.current = submit;
  });

  if (sold) {
    return <SoldView sold={sold} exchange={soldExchange} onClose={onClose} />;
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{exchange ? exchangeCopy.banner : copy.title}</DialogTitle>
        <DialogDescription>
          {exchange ? `${exchange.saleNumber} · ` : ""}
          {summary.units} {messages.pos.ticket.units}
          {customer ? ` · ${customer.name}` : ""}
        </DialogDescription>
      </DialogHeader>

      <div
        role="group"
        aria-label={exchange ? exchangeCopy.toPay : copy.total}
        className="bg-muted rounded-lg px-4 py-3"
      >
        {exchange ? (
          <p className="text-muted-foreground text-sm tabular-nums">
            {copy.total}: {formatMoney(total)} · {exchangeCopy.credit}: −{formatMoney(credit)}
          </p>
        ) : null}
        <p className="text-muted-foreground text-sm">
          {exchange ? exchangeCopy.toPay : copy.total}
        </p>
        <p className="text-4xl font-bold tabular-nums">{formatMoney(exchange ? payable : total)}</p>
        <p className="mt-1 flex flex-wrap gap-x-6 text-sm tabular-nums">
          <span>
            {copy.paid}: <strong>{formatMoney(paidCents)}</strong>
          </span>
          {remainingCents > 0 ? (
            <span className="text-warning">
              {copy.remaining}: <strong>{formatMoney(remainingCents)}</strong>
            </span>
          ) : (
            <span role="status" className="text-success">
              {copy.change}: <strong>{formatMoney(changeCents)}</strong>
            </span>
          )}
        </p>
      </div>

      {lines.length > 0 ? (
        <ul aria-label={copy.payments} className="space-y-1 text-sm">
          {lines.map((line, index) => (
            <li
              key={`${line.method}-${index}`}
              className="flex items-center justify-between rounded-lg border px-3 py-1.5"
            >
              <span>
                {copy.methods[line.method]}
                {line.reference ? ` · ${line.reference}` : ""}
              </span>
              <span className="flex items-center gap-2 tabular-nums">
                {formatMoney(line.amountCents)}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`${copy.removePayment}: ${copy.methods[line.method]} ${formatMoney(line.amountCents)}`}
                  onClick={() => setLines(lines.filter((_, at) => at !== index))}
                >
                  <X aria-hidden="true" />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {payable > 0 ? (
        <>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium">{copy.method}</legend>
            <div
              className={cn(
                "grid grid-cols-2 gap-2",
                methods.length > 4 ? "sm:grid-cols-5" : "sm:grid-cols-4",
              )}
            >
              {methods.map((option) => {
                const Icon = METHOD_ICON[option];
                return (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={method === option}
                    onClick={() => chooseMethod(option)}
                    className={cn(
                      "focus-visible:ring-ring/50 flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-lg border text-sm font-medium outline-none focus-visible:ring-3",
                      method === option
                        ? "border-primary bg-primary text-primary-foreground"
                        : "hover:bg-muted",
                    )}
                  >
                    <Icon aria-hidden="true" className="size-5" />
                    {copy.methods[option]}
                    {option === "STORE_CREDIT" ? (
                      <span className="text-xs font-normal tabular-nums">
                        {copy.creditBalance} {formatMoney(creditLeftCents)}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label={copy.amount} htmlFor="charge-amount">
              <MoneyInput
                id="charge-amount"
                autoFocus
                selectOnFocus
                valueCents={amountCents}
                onValueChange={setAmountCents}
                onEnter={() => submitRef.current()}
                className="h-11 text-xl font-semibold"
              />
            </FormField>
            {method === "CASH" || method === "STORE_CREDIT" ? null : (
              <FormField
                label={copy.reference}
                htmlFor="charge-reference"
                hint={copy.referenceHint}
              >
                <Input
                  id="charge-reference"
                  autoComplete="off"
                  maxLength={60}
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                />
              </FormField>
            )}
          </div>

          {method === "CASH" ? (
            <div className="flex flex-wrap gap-2" role="group" aria-label={copy.quick}>
              <Button
                type="button"
                variant="outline"
                onClick={() => setAmountCents(Math.max(0, total - addedCents) || null)}
              >
                {copy.exact}
              </Button>
              {QUICK_BILLS.map((bill) => (
                <Button
                  key={bill}
                  type="button"
                  variant="outline"
                  onClick={() => setAmountCents(bill)}
                >
                  {formatMoney(bill)}
                </Button>
              ))}
            </div>
          ) : null}

          {remainingCents > 0 && draftCents > 0 ? (
            <Button type="button" variant="secondary" onClick={addPayment}>
              {copy.addPayment}
            </Button>
          ) : null}
        </>
      ) : (
        <p role="status" className="text-sm">
          {exchangeCopy.noPayment}
        </p>
      )}

      {exchange && leftover > 0 ? (
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">
            {exchangeCopy.leftoverTitle}{" "}
            <strong className="tabular-nums">{formatMoney(leftover)}</strong>
          </legend>
          {(["STORE_CREDIT", "ORIGINAL", "CASH"] as const).map((option) => {
            const disabled = option === "ORIGINAL" && !exchange.originalRefundable;
            const hint =
              option === "STORE_CREDIT"
                ? messages.returns.refund.creditHint
                : option === "ORIGINAL"
                  ? exchange.originalRefundable
                    ? messages.returns.refund.originalHint
                    : messages.returns.refund.originalUnavailable
                  : messages.returns.refund.cashHint;
            return (
              <label
                key={option}
                className={cn(
                  "flex items-start gap-2 rounded-lg border p-2.5 text-sm",
                  leftoverMethod === option && "border-primary bg-primary/5",
                  disabled && "opacity-60",
                )}
              >
                <input
                  type="radio"
                  name="exchange-refund-method"
                  value={option}
                  checked={leftoverMethod === option}
                  disabled={disabled}
                  onChange={() => setLeftoverMethod(option)}
                  className="accent-primary mt-0.5 size-4"
                />
                <span>
                  <span className="font-medium">{messages.returns.methods[option]}</span>
                  <span className="text-muted-foreground block text-xs">{hint}</span>
                </span>
              </label>
            );
          })}
        </fieldset>
      ) : null}

      {config.invoicing.available ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={invoice}
            onChange={(event) => setInvoice(event.target.checked)}
            className="accent-primary size-4"
          />
          {copy.invoice}
        </label>
      ) : config.invoicing.alerts.length > 0 ? (
        <p className="text-muted-foreground text-sm">{messages.fiscalAlerts.unavailable}</p>
      ) : null}
      {invoice && config.invoicing.available ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={copy.invoiceTaxId} htmlFor="charge-tax-id">
            <Input
              id="charge-tax-id"
              autoComplete="off"
              maxLength={30}
              value={taxId}
              onChange={(event) => setTaxId(event.target.value)}
            />
          </FormField>
          <FormField label={copy.invoiceName} htmlFor="charge-invoice-name" hint={copy.invoiceHint}>
            <Input
              id="charge-invoice-name"
              autoComplete="off"
              maxLength={120}
              value={invoiceName}
              onChange={(event) => setInvoiceName(event.target.value)}
            />
          </FormField>
        </div>
      ) : null}

      {needsApproval ? (
        <fieldset className="bg-warning/10 space-y-3 rounded-lg border p-3">
          <legend className="px-1 text-sm font-medium">{copy.approval.title}</legend>
          <p className="text-sm">
            {exchange ? messages.returns.approval.hint : copy.approval.hint}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label={copy.approval.username} htmlFor="override-username">
              <Input
                id="override-username"
                autoComplete="off"
                value={override.username}
                onChange={(event) => setOverride({ ...override, username: event.target.value })}
              />
            </FormField>
            <FormField label={copy.approval.pin} htmlFor="override-pin">
              <Input
                id="override-pin"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={6}
                value={override.pin}
                onChange={(event) =>
                  setOverride({ ...override, pin: event.target.value.replace(/\D/g, "") })
                }
              />
            </FormField>
          </div>
        </fieldset>
      ) : null}

      {error ? <Notice tone="error">{error}</Notice> : null}

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" loading={pending} onClick={onClose}>
          {copy.back}
        </Button>
        <Button
          type="button"
          className="h-12 min-w-40 text-lg font-semibold"
          loading={pending}
          autoFocus={payable === 0}
          onClick={submit}
        >
          {pending
            ? copy.submitting
            : exchange
              ? payable > 0
                ? `${copy.submit} ${formatMoney(payable)}`
                : exchangeCopy.submit
              : `${copy.submit} ${formatMoney(total)}`}
        </Button>
      </div>
    </>
  );
}

/** Pantalla de éxito: el cambio a entregar en grande y las opciones de imprimir. Enter = nueva venta. */
function SoldView({
  sold,
  exchange,
  onClose,
}: {
  sold: SoldSale;
  exchange: SoldExchange | null;
  onClose: () => void;
}) {
  const done = copy.done;
  const swapDone = exchangeCopy.done;
  return (
    <>
      <DialogHeader>
        <DialogTitle>{exchange ? swapDone.title : done.title}</DialogTitle>
        <DialogDescription>
          {done.ticket} {sold.number}
          {sold.fiscalNumber ? ` · ${done.invoice} ${sold.fiscalNumber}` : ""}
          {exchange ? ` · ${swapDone.returnReceipt} ${exchange.doc.number}` : ""}
        </DialogDescription>
      </DialogHeader>
      <div role="status" className="bg-muted space-y-1 rounded-lg px-4 py-4 text-center">
        <SuccessCheck className="mx-auto mb-2" />
        <p className="text-muted-foreground text-sm">
          {sold.changeCents > 0 ? done.change : done.noChange}
        </p>
        <p className="text-5xl font-bold tabular-nums">{formatMoney(sold.changeCents)}</p>
        {exchange ? (
          <>
            <p className="text-muted-foreground text-sm tabular-nums">
              {done.total} {formatMoney(sold.totalCents)} · {swapDone.credit}{" "}
              {formatMoney(exchange.creditAppliedCents)} · {swapDone.toPay}{" "}
              {formatMoney(sold.totalCents - exchange.creditAppliedCents)}
            </p>
            {exchange.doc.refundCents > 0 ? (
              <p className="text-sm font-medium tabular-nums">
                {swapDone.leftover} {formatMoney(exchange.doc.refundCents)} ·{" "}
                {
                  messages.returns.methods[
                    exchange.doc.refundMethod as keyof typeof messages.returns.methods
                  ]
                }
              </p>
            ) : null}
            {exchange.doc.creditNote ? (
              <p className="text-sm font-medium">
                {messages.returns.creditNote.issued} {exchange.doc.creditNote}
              </p>
            ) : null}
            {exchange.doc.creditNoteMissing ? (
              <Notice tone="warning" role="alert">
                {messages.returns.creditNote.missing}
              </Notice>
            ) : null}
          </>
        ) : (
          <p className="text-muted-foreground text-sm tabular-nums">
            {done.total} {formatMoney(sold.totalCents)} · {done.paid} {formatMoney(sold.paidCents)}
          </p>
        )}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <a
          href={`/imprimir/ticket/${sold.id}?auto=1`}
          target="_blank"
          rel="noreferrer"
          className={buttonVariants({ variant: "outline" })}
        >
          {done.printTicket}
        </a>
        {exchange ? (
          <a
            href={`/imprimir/devolucion/${exchange.doc.id}?auto=1`}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ variant: "outline" })}
          >
            {swapDone.printReturn}
          </a>
        ) : null}
        {sold.fiscalNumber ? (
          <a
            href={`/imprimir/factura/${sold.id}?auto=1`}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ variant: "outline" })}
          >
            {done.printInvoice}
          </a>
        ) : null}
        <Button
          type="button"
          autoFocus
          className="h-12 min-w-40 text-lg font-semibold"
          onClick={onClose}
        >
          {done.newSale}
        </Button>
      </div>
    </>
  );
}
