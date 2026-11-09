"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { FormField } from "@/components/shared/form-field";
import { MoneyInput } from "@/components/shared/money-input";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/shared/notice";
import { messages } from "@/config/messages.es";
import { formatLocalDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { openCashAction } from "@/modules/cash/actions";
import type { CashActionState } from "@/modules/cash/types";

const copy = messages.cash.open;

export type InheritedFloatView = {
  cents: number;
  /** ISO: viene de un componente de servidor. */
  closedAt: string;
  closedByName: string;
};

/**
 * Abre el turno. Si el último cierre dejó efectivo en el cajón, ese saldo anterior es el fondo: se muestra y no se edita
 * (cualquier diferencia se registra después como entrada o salida, con su motivo). Si no dejó nada, el fondo se escribe.
 */
export function OpenCashForm({
  inherited: inheritedFloat = null,
}: {
  inherited?: InheritedFloatView | null;
}) {
  const router = useRouter();
  const inherited = inheritedFloat && inheritedFloat.cents > 0 ? inheritedFloat : null;
  const [floatCents, setFloatCents] = useState<number | null>(null);
  const [state, setState] = useState<CashActionState>(undefined);
  const [pending, startTransition] = useTransition();

  function submit() {
    setState(undefined);
    startTransition(async () => {
      const result = await openCashAction(inherited?.cents ?? floatCents ?? Number.NaN);
      setState(result);
      if (result?.success) {
        toast.success(messages.toasts.cashOpened);
        router.refresh();
      }
    });
  }

  return (
    <section aria-label={copy.title} className="bg-card space-y-4 rounded-lg border p-4">
      {inherited ? (
        <div className="space-y-1 text-center">
          <p className="text-muted-foreground text-sm">{copy.previous}</p>
          <p className="text-3xl font-semibold tabular-nums">{formatMoney(inherited.cents)}</p>
          <p className="text-muted-foreground text-sm">
            {inherited.closedByName} · {formatLocalDateTime(new Date(inherited.closedAt))}
          </p>
        </div>
      ) : (
        <div className="max-w-xs">
          <FormField label={copy.float} htmlFor="opening-float">
            <MoneyInput
              id="opening-float"
              valueCents={floatCents}
              onValueChange={setFloatCents}
              placeholder="L 0.00"
            />
          </FormField>
        </div>
      )}
      <Button type="button" className="h-11 w-full text-base" loading={pending} onClick={submit}>
        {pending ? copy.submitting : copy.submit}
      </Button>
      {state?.error ? <Notice tone="error">{state.error}</Notice> : null}
    </section>
  );
}
