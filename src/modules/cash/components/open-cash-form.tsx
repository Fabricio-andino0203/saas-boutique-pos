"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { FormField } from "@/components/shared/form-field";
import { MoneyInput } from "@/components/shared/money-input";
import { Button } from "@/components/ui/button";
import { messages } from "@/config/messages.es";
import { openCashAction } from "@/modules/cash/actions";
import type { CashActionState } from "@/modules/cash/types";

const copy = messages.cash.open;

export function OpenCashForm({ terminalName }: { terminalName: string }) {
  const router = useRouter();
  const [floatCents, setFloatCents] = useState<number | null>(null);
  const [state, setState] = useState<CashActionState>(undefined);
  const [pending, startTransition] = useTransition();

  function submit() {
    setState(undefined);
    startTransition(async () => {
      const result = await openCashAction(floatCents ?? Number.NaN);
      setState(result);
      if (result?.success) {
        router.refresh();
      }
    });
  }

  return (
    <section aria-labelledby="open-cash-title" className="bg-card space-y-4 rounded-lg border p-4">
      <div className="space-y-1">
        <h2 id="open-cash-title" className="text-lg font-medium">
          {copy.title}
        </h2>
        <p className="text-muted-foreground text-sm">
          {terminalName} · {copy.description}
        </p>
      </div>
      <div className="max-w-xs">
        <FormField label={copy.float} htmlFor="opening-float" hint={copy.floatHint}>
          <MoneyInput
            id="opening-float"
            valueCents={floatCents}
            onValueChange={setFloatCents}
            placeholder="L 0.00"
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
    </section>
  );
}
