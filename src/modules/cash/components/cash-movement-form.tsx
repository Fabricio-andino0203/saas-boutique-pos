"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { FormField } from "@/components/shared/form-field";
import { MoneyInput } from "@/components/shared/money-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { messages } from "@/config/messages.es";
import { addCashMovementAction } from "@/modules/cash/actions";
import type { CashActionState } from "@/modules/cash/types";

const copy = messages.cash.movements;

export function CashMovementForm() {
  const router = useRouter();
  const [type, setType] = useState<"IN" | "OUT">("OUT");
  const [amountCents, setAmountCents] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [state, setState] = useState<CashActionState>(undefined);
  const [pending, startTransition] = useTransition();

  function submit() {
    setState(undefined);
    startTransition(async () => {
      const result = await addCashMovementAction({
        type,
        amountCents: amountCents ?? 0,
        reason,
      });
      setState(result);
      if (result?.success) {
        setAmountCents(null);
        setReason("");
        router.refresh();
      }
    });
  }

  return (
    <section aria-labelledby="movement-title" className="bg-card space-y-4 rounded-lg border p-4">
      <div className="space-y-1">
        <h2 id="movement-title" className="text-lg font-medium">
          {copy.title}
        </h2>
        <p className="text-muted-foreground text-sm">{copy.description}</p>
      </div>
      <fieldset className="flex flex-wrap gap-x-6 gap-y-2">
        <legend className="mb-1 text-sm font-medium">{copy.type}</legend>
        {(["OUT", "IN"] as const).map((option) => (
          <label key={option} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="movement-type"
              value={option}
              checked={type === option}
              onChange={() => setType(option)}
              className="accent-primary size-4"
            />
            {copy[option]}
          </label>
        ))}
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
        <FormField label={copy.amount} htmlFor="movement-amount">
          <MoneyInput
            id="movement-amount"
            valueCents={amountCents}
            onValueChange={setAmountCents}
            placeholder="L 0.00"
          />
        </FormField>
        <FormField label={copy.reason} htmlFor="movement-reason" hint={copy.reasonHint}>
          <Input
            id="movement-reason"
            value={reason}
            maxLength={200}
            onChange={(event) => setReason(event.target.value)}
          />
        </FormField>
      </div>
      <Button type="button" disabled={pending} onClick={submit}>
        {pending ? copy.submitting : copy.submit}
      </Button>
      {state?.error ? (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      ) : null}
      {state?.success ? (
        <p role="status" className="text-success text-sm">
          {state.success}
        </p>
      ) : null}
    </section>
  );
}
