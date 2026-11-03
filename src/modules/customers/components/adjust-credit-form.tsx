"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { FormField } from "@/components/shared/form-field";
import { MoneyInput } from "@/components/shared/money-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/shared/notice";
import { messages } from "@/config/messages.es";
import { newId } from "@/lib/client-id";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { adjustCreditAction } from "@/modules/customers/actions";

const copy = messages.customers.adjust;

type Direction = "ADD" | "SUBTRACT";

/** Suma o resta crédito a mano, siempre con motivo. Solo la ven quienes pueden ajustarlo; el servidor lo vuelve a revisar. */
export function AdjustCreditForm({ customerId }: { customerId: string }) {
  const router = useRouter();
  // Se renueva después de cada ajuste: reintentar un envío fallido con el mismo valor no ajusta dos veces.
  const [requestId, setRequestId] = useState(() => newId());
  const [direction, setDirection] = useState<Direction>("ADD");
  const [amountCents, setAmountCents] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    setDone(null);
    if (!amountCents || amountCents <= 0) {
      setError(copy.errors.amount);
      return;
    }
    if (reason.trim().length < 3) {
      setError(copy.errors.reason);
      return;
    }
    startTransition(async () => {
      const result = await adjustCreditAction({
        requestId,
        customerId,
        direction,
        amountCents,
        reason,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setDone(`${copy.done} ${formatMoney(result.balanceCents)}`);
      setRequestId(newId());
      setAmountCents(null);
      setReason("");
      router.refresh();
    });
  }

  return (
    <form
      aria-labelledby="adjust-credit-title"
      className="bg-card space-y-3 rounded-lg border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div>
        <h3 id="adjust-credit-title" className="font-medium">
          {copy.title}
        </h3>
        <p className="text-muted-foreground text-sm">{copy.description}</p>
      </div>
      <fieldset className="flex flex-wrap gap-2">
        <legend className="sr-only">{copy.direction}</legend>
        {(["ADD", "SUBTRACT"] as const).map((option) => (
          <label
            key={option}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
              direction === option && "border-primary bg-primary/5",
            )}
          >
            <input
              type="radio"
              name="credit-direction"
              value={option}
              checked={direction === option}
              onChange={() => setDirection(option)}
              className="accent-primary size-4"
            />
            {copy.directions[option]}
          </label>
        ))}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <FormField label={copy.amount} htmlFor="credit-amount">
          <MoneyInput
            id="credit-amount"
            valueCents={amountCents}
            onValueChange={setAmountCents}
            selectOnFocus
          />
        </FormField>
        <FormField label={copy.reason} htmlFor="credit-reason">
          <Input
            id="credit-reason"
            autoComplete="off"
            maxLength={200}
            placeholder={copy.reasonPlaceholder}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </FormField>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {done ? <Notice tone="success">{done}</Notice> : null}
      <Button type="submit" loading={pending}>
        {pending ? copy.submitting : copy.submit}
      </Button>
    </form>
  );
}
