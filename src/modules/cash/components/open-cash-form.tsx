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
 * Abre el turno. Si el último cierre de la terminal dejó efectivo en el cajón, ese fondo ya aparece puesto; cambiarlo (cuando
 * lo heredado era mayor que cero) pide explicar por qué.
 */
export function OpenCashForm({
  terminalName,
  inherited = null,
}: {
  terminalName: string;
  inherited?: InheritedFloatView | null;
}) {
  const router = useRouter();
  const [floatCents, setFloatCents] = useState<number | null>(inherited?.cents ?? null);
  const [notes, setNotes] = useState("");
  const [state, setState] = useState<CashActionState>(undefined);
  const [pending, startTransition] = useTransition();

  const differs = inherited !== null && inherited.cents > 0 && floatCents !== inherited.cents;
  const notesReady = !differs || notes.trim().length >= 3;

  function submit() {
    setState(undefined);
    startTransition(async () => {
      const result = await openCashAction(floatCents ?? Number.NaN, differs ? notes : undefined);
      setState(result);
      if (result?.success) {
        toast.success(messages.toasts.cashOpened);
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
      {inherited ? (
        <div role="note" className="bg-muted/50 space-y-0.5 rounded-lg p-3 text-sm">
          <p className="font-medium">
            {copy.inherited}: <span className="tabular-nums">{formatMoney(inherited.cents)}</span>
          </p>
          <p className="text-muted-foreground text-xs">
            {copy.inheritedBy} {inherited.closedByName} ·{" "}
            {formatLocalDateTime(new Date(inherited.closedAt))}. {copy.inheritedHint}
          </p>
        </div>
      ) : null}
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
      {differs ? (
        <FormField label={copy.changedNotes} htmlFor="opening-notes" hint={copy.changedNotesHint}>
          <textarea
            id="opening-notes"
            rows={2}
            maxLength={300}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 w-full min-w-0 rounded-lg border px-2.5 py-1.5 text-base outline-none focus-visible:ring-3 md:text-sm"
          />
        </FormField>
      ) : null}
      <Button type="button" loading={pending} disabled={!notesReady} onClick={submit}>
        {pending ? copy.submitting : copy.submit}
      </Button>
      {state?.error ? <Notice tone="error">{state.error}</Notice> : null}
    </section>
  );
}
