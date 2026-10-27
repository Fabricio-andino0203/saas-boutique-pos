"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { FormField } from "@/components/shared/form-field";
import { NativeSelect } from "@/components/shared/native-select";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { messages } from "@/config/messages.es";
import { newId } from "@/lib/client-id";
import { formatLocalDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { valueOfUnits } from "@/modules/returns/calc";
import { processReturnAction } from "@/modules/returns/actions";
import type { ReturnableSale } from "@/modules/returns/queries";
import {
  RETURN_CONDITIONS,
  type RefundChoice,
  type ReturnCondition,
} from "@/modules/returns/schemas";
import { hydratePosStore, usePosStore } from "@/modules/sales/cart-store";
import { CustomerDialog } from "@/modules/sales/components/pos-dialogs";
import type { QuickCustomer } from "@/modules/sales/pos-types";

const copy = messages.returns;

type ReturnFormProps = {
  sale: ReturnableSale;
  /** Puede hacer devoluciones fuera de política sin autorización (gerente y propietario). */
  canOverridePolicy: boolean;
  /** Puede reembolsar en efectivo sin autorización (gerente y propietario). */
  canRefundCash: boolean;
  /** Puede vender (para cambiar la prenda por otra en la pantalla de venta). */
  canExchange: boolean;
};

type Done = {
  id: string;
  number: string;
  refundCents: number;
  refundMethod: string;
  creditNote: string | null;
  creditNoteMissing: boolean;
};

export function ReturnForm({
  sale,
  canOverridePolicy,
  canRefundCash,
  canExchange,
}: ReturnFormProps) {
  const router = useRouter();
  // Se genera una vez por pantalla: reintentar el envío con él no devuelve dos veces lo mismo.
  const [requestId] = useState(() => newId());
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [conditions, setConditions] = useState<Record<string, ReturnCondition>>({});
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState<RefundChoice>("STORE_CREDIT");
  const [customer, setCustomer] = useState<QuickCustomer | null>(
    sale.customer
      ? { id: sale.customer.id, name: sale.customer.name, phone: sale.customer.phone }
      : null,
  );
  const [customerOpen, setCustomerOpen] = useState(false);
  const [override, setOverride] = useState({ username: "", pin: "" });
  const [askedApproval, setAskedApproval] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [pending, startTransition] = useTransition();

  const chosen = useMemo(
    () =>
      sale.lines
        .map((line) => ({ line, quantity: quantities[line.saleItemId] ?? 0 }))
        .filter((entry) => entry.quantity > 0),
    [sale.lines, quantities],
  );
  const refundCents = chosen.reduce(
    (sum, { line, quantity }) =>
      sum + valueOfUnits(line.lineTotalCents, line.quantity, line.returned, quantity),
    0,
  );
  const units = chosen.reduce((sum, entry) => sum + entry.quantity, 0);

  const outsidePolicy =
    chosen.length > 0 &&
    (sale.policy.outsideWindow || chosen.some((entry) => entry.line.blockedByCategory));
  const needsPin =
    askedApproval || (outsidePolicy && !canOverridePolicy) || (method === "CASH" && !canRefundCash);

  function setQuantity(saleItemId: string, value: number, max: number) {
    setQuantities((current) => ({ ...current, [saleItemId]: Math.max(0, Math.min(max, value)) }));
  }

  /** Pasa a la pantalla de venta con lo devuelto ya elegido: allí se arma lo que se lleva y se cobra la diferencia. */
  async function startExchange() {
    setError(null);
    if (chosen.length === 0) {
      setError(copy.errors.nothing);
      return;
    }
    if (reason.trim().length < 3) {
      setError(copy.errors.reason);
      return;
    }
    // Se lee el ticket guardado antes de tocarlo: así el que estaba armado pasa a espera y no se pierde.
    await hydratePosStore();
    usePosStore.getState().startExchange(
      {
        requestId: newId(),
        saleId: sale.id,
        saleNumber: sale.number,
        items: chosen.map(({ line, quantity }) => ({
          saleItemId: line.saleItemId,
          quantity,
          condition: conditions[line.saleItemId] ?? "RESELLABLE",
        })),
        units,
        reason: reason.trim(),
        valueCents: refundCents,
        refundMethod: method,
        originalRefundable: sale.originalRefundable,
      },
      customer,
    );
    router.push("/vender");
  }

  function submit() {
    setError(null);
    if (chosen.length === 0) {
      setError(copy.errors.nothing);
      return;
    }
    if (reason.trim().length < 3) {
      setError(copy.errors.reason);
      return;
    }
    if (method === "STORE_CREDIT" && !customer) {
      setError(copy.errors.customer);
      return;
    }
    startTransition(async () => {
      const result = await processReturnAction({
        clientRequestId: requestId,
        saleId: sale.id,
        items: chosen.map(({ line, quantity }) => ({
          saleItemId: line.saleItemId,
          quantity,
          condition: conditions[line.saleItemId] ?? "RESELLABLE",
        })),
        reason,
        refundMethod: method,
        ...(customer ? { customerId: customer.id } : {}),
        ...(needsPin && override.username.trim() && override.pin
          ? { managerOverride: { username: override.username, pin: override.pin } }
          : {}),
      });
      if (result.ok) {
        setDone(result.doc);
        return;
      }
      if (result.code === "NEEDS_APPROVAL") {
        setAskedApproval(true);
      }
      setError(result.message);
    });
  }

  if (done) {
    return (
      <section
        role="status"
        className="bg-card mx-auto max-w-lg space-y-4 rounded-lg border p-6 text-center"
      >
        <h2 className="text-2xl font-semibold">{copy.done.title}</h2>
        <p className="text-muted-foreground text-sm">
          {copy.done.number} {done.number}
        </p>
        <div className="bg-muted rounded-lg px-4 py-4">
          <p className="text-muted-foreground text-sm">{copy.done.refunded}</p>
          <p className="text-4xl font-bold tabular-nums">{formatMoney(done.refundCents)}</p>
          <p className="text-muted-foreground text-sm">
            {copy.done.method}: {copy.methods[done.refundMethod as keyof typeof copy.methods]}
          </p>
        </div>
        {done.creditNote ? (
          <p className="text-sm font-medium">
            {copy.creditNote.issued} {done.creditNote}
          </p>
        ) : null}
        {done.creditNoteMissing ? (
          <p role="alert" className="text-warning text-sm">
            {copy.creditNote.missing}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-center gap-2">
          <a
            href={`/imprimir/devolucion/${done.id}?auto=1`}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ variant: "outline" })}
          >
            {copy.done.print}
          </a>
          <Link href="/devoluciones" className={buttonVariants()}>
            {copy.done.another}
          </Link>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <section
        aria-labelledby="return-sale"
        className="bg-card space-y-1 rounded-lg border p-4 text-sm"
      >
        <h2 id="return-sale" className="font-medium">
          {copy.sale.title} {sale.number}
        </h2>
        <p className="text-muted-foreground">
          {copy.sale.date}: {formatLocalDateTime(sale.createdAt)} · {copy.sale.customer}:{" "}
          {sale.customer?.name ?? copy.sale.finalConsumer}
        </p>
        {sale.policy.outsideWindow ? (
          <p role="status" className="text-warning">
            {copy.policy.outsideBefore} {sale.policy.daysSince} {copy.policy.outsideMiddle}{" "}
            {sale.policy.maxDays} {copy.policy.outsideAfter} {copy.policy.needsManager}
          </p>
        ) : null}
      </section>

      <section aria-labelledby="return-lines" className="space-y-2">
        <h2 id="return-lines" className="text-lg font-medium">
          {copy.lines.title}
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{copy.lines.title}</caption>
            <thead>
              <tr className="text-muted-foreground border-b text-left">
                <th className="py-1.5 pr-3 font-medium">{copy.lines.product}</th>
                <th className="py-1.5 pr-3 text-right font-medium">{copy.lines.sold}</th>
                <th className="py-1.5 pr-3 text-right font-medium">{copy.lines.returned}</th>
                <th className="py-1.5 pr-3 font-medium">{copy.lines.quantity}</th>
                <th className="py-1.5 pr-3 font-medium">{copy.lines.condition}</th>
                <th className="py-1.5 text-right font-medium">{copy.lines.refund}</th>
              </tr>
            </thead>
            <tbody>
              {sale.lines.map((line) => {
                const quantity = quantities[line.saleItemId] ?? 0;
                const label = [line.sizeName, line.colorName].filter(Boolean).join(" · ");
                const name = `${line.productName}${label ? ` ${label}` : ""}`;
                return (
                  <tr key={line.saleItemId} className="border-b align-top last:border-0">
                    <td className="py-2 pr-3">
                      {line.productName}
                      <span className="text-muted-foreground block text-xs">
                        {label}
                        {label ? " · " : ""}
                        {line.sku}
                      </span>
                      {line.blockedByCategory ? (
                        <span className="text-warning block text-xs">
                          {copy.policy.categoryBlocked} {copy.policy.needsManager}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{line.quantity}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{line.returned}</td>
                    <td className="py-2 pr-3">
                      {line.returnable === 0 ? (
                        <span className="text-muted-foreground text-xs">
                          {copy.lines.allReturned}
                        </span>
                      ) : (
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="outline"
                            size="icon-sm"
                            aria-label={`− ${name}`}
                            onClick={() =>
                              setQuantity(line.saleItemId, quantity - 1, line.returnable)
                            }
                          >
                            −
                          </Button>
                          <Input
                            inputMode="numeric"
                            aria-label={`${copy.lines.quantityOf} ${name}`}
                            value={String(quantity)}
                            onFocus={(event) => event.currentTarget.select()}
                            onChange={(event) =>
                              setQuantity(
                                line.saleItemId,
                                Number(event.target.value.replace(/\D/g, "").slice(0, 4)) || 0,
                                line.returnable,
                              )
                            }
                            className="w-14 text-center tabular-nums"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="icon-sm"
                            aria-label={`+ ${name}`}
                            onClick={() =>
                              setQuantity(line.saleItemId, quantity + 1, line.returnable)
                            }
                          >
                            +
                          </Button>
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      {quantity > 0 ? (
                        <NativeSelect
                          aria-label={`${copy.lines.conditionOf} ${name}`}
                          value={conditions[line.saleItemId] ?? "RESELLABLE"}
                          onChange={(event) =>
                            setConditions((current) => ({
                              ...current,
                              [line.saleItemId]: event.target.value as ReturnCondition,
                            }))
                          }
                          className="w-52"
                        >
                          {RETURN_CONDITIONS.map((condition) => (
                            <option key={condition} value={condition}>
                              {copy.conditions[condition]}
                            </option>
                          ))}
                        </NativeSelect>
                      ) : null}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {quantity > 0
                        ? formatMoney(
                            valueOfUnits(
                              line.lineTotalCents,
                              line.quantity,
                              line.returned,
                              quantity,
                            ),
                          )
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <FormField label={copy.reason.label} htmlFor="return-reason">
        <Input
          id="return-reason"
          autoComplete="off"
          maxLength={200}
          placeholder={copy.reason.placeholder}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </FormField>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-sm font-medium">{copy.refund.title}</legend>
        {(["STORE_CREDIT", "ORIGINAL", "CASH"] as const).map((option) => {
          const disabled = option === "ORIGINAL" && !sale.originalRefundable;
          const hint =
            option === "STORE_CREDIT"
              ? copy.refund.creditHint
              : option === "ORIGINAL"
                ? sale.originalRefundable
                  ? copy.refund.originalHint
                  : copy.refund.originalUnavailable
                : copy.refund.cashHint;
          return (
            <label
              key={option}
              className={cn(
                "flex items-start gap-2 rounded-lg border p-3 text-sm",
                method === option && "border-primary bg-primary/5",
                disabled && "opacity-60",
              )}
            >
              <input
                type="radio"
                name="refund-method"
                value={option}
                checked={method === option}
                disabled={disabled}
                onChange={() => setMethod(option)}
                className="accent-primary mt-0.5 size-4"
              />
              <span>
                <span className="font-medium">{copy.methods[option]}</span>
                <span className="text-muted-foreground block text-xs">{hint}</span>
              </span>
            </label>
          );
        })}
        {method === "STORE_CREDIT" ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span>
              {copy.refund.customer}: <strong>{customer?.name ?? "—"}</strong>
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => setCustomerOpen(true)}>
              {customer ? copy.refund.changeCustomer : copy.refund.chooseCustomer}
            </Button>
            {customer && sale.customer && customer.id === sale.customer.id ? (
              <span className="text-muted-foreground text-xs tabular-nums">
                {copy.refund.balance}: {formatMoney(sale.customer.storeCreditCents)}
              </span>
            ) : null}
          </div>
        ) : null}
      </fieldset>

      <div
        role="group"
        aria-label={copy.total.label}
        className="bg-muted flex flex-wrap items-baseline justify-between gap-2 rounded-lg px-4 py-3"
      >
        <span className="text-lg font-semibold">
          {copy.total.label}{" "}
          <span className="text-muted-foreground text-sm font-normal">
            ({units} {copy.total.units})
          </span>
        </span>
        <span className="text-3xl font-bold tabular-nums">{formatMoney(refundCents)}</span>
      </div>

      {needsPin ? (
        <fieldset className="bg-warning/10 space-y-3 rounded-lg border p-3">
          <legend className="px-1 text-sm font-medium">{copy.approval.title}</legend>
          <p className="text-sm">{copy.approval.hint}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label={copy.approval.username} htmlFor="return-username">
              <Input
                id="return-username"
                autoComplete="off"
                value={override.username}
                onChange={(event) => setOverride({ ...override, username: event.target.value })}
              />
            </FormField>
            <FormField label={copy.approval.pin} htmlFor="return-pin">
              <Input
                id="return-pin"
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

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        <Link href="/devoluciones" className={buttonVariants({ variant: "ghost" })}>
          {copy.search.back}
        </Link>
        {canExchange ? (
          <Button
            type="button"
            variant="outline"
            className="h-12 text-base"
            disabled={pending}
            onClick={() => void startExchange()}
          >
            {messages.returns.exchange.action}
          </Button>
        ) : null}
        <Button
          type="button"
          className="h-12 min-w-48 text-lg font-semibold"
          disabled={pending}
          onClick={submit}
        >
          {pending ? copy.submitting : copy.submit}
        </Button>
      </div>

      <CustomerDialog
        open={customerOpen}
        current={customer}
        onSelect={(next) => {
          setCustomer(next);
          setCustomerOpen(false);
        }}
        onClose={() => setCustomerOpen(false)}
      />
    </div>
  );
}
