"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { FormField } from "@/components/shared/form-field";
import { MoneyInput } from "@/components/shared/money-input";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/shared/notice";
import { messages } from "@/config/messages.es";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { previewCashCloseAction, submitCashCloseAction } from "@/modules/cash/actions";
import {
  DENOMINATIONS_CENTS,
  sumDenominations,
  type DenominationCounts,
} from "@/modules/cash/schemas";

const copy = messages.cash.close;

type Preview = { expectedCents: number; differenceCents: number };

/** Lo que el cajero escribió en el desglose, como cantidades enteras (lo vacío o inválido es cero). */
function toCounts(quantities: Record<string, string>): DenominationCounts {
  const counts: DenominationCounts = {};
  for (const denomination of DENOMINATIONS_CENTS) {
    const value = Number(quantities[denomination]);
    counts[denomination] = Number.isInteger(value) && value > 0 ? value : 0;
  }
  return counts;
}

/**
 * Cierre en dos pasos: primero se cuenta el efectivo y se ve la diferencia con lo esperado; después se
 * comenta (obligatorio si no cuadra) y se cierra. El servidor vuelve a calcular todo al cerrar.
 */
export function CloseCashForm() {
  const router = useRouter();
  const [byDenomination, setByDenomination] = useState(false);
  const [totalCents, setTotalCents] = useState<number | null>(null);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const counts = toCounts(quantities);
  const countedCents = byDenomination ? sumDenominations(counts) : totalCents;
  const difference = preview?.differenceCents ?? 0;
  const needsNotes = preview !== null && difference !== 0;
  const notesReady = !needsNotes || notes.trim().length >= 3;

  function check() {
    setError(null);
    if (countedCents === null) {
      setError(copy.invalidCount);
      return;
    }
    startTransition(async () => {
      const result = await previewCashCloseAction(countedCents);
      if ("error" in result) {
        setError(result.error);
      } else {
        setPreview(result);
      }
    });
  }

  function close() {
    setError(null);
    startTransition(async () => {
      const result = await submitCashCloseAction({
        countedCashCents: countedCents ?? Number.NaN,
        denominations: byDenomination ? counts : undefined,
        notes,
      });
      if ("id" in result) {
        router.push(`/caja/cierres/${result.id}`);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <section aria-labelledby="close-cash-title" className="bg-card space-y-4 rounded-lg border p-4">
      <div className="space-y-1">
        <h2 id="close-cash-title" className="text-lg font-medium">
          {copy.title}
        </h2>
        <p className="text-muted-foreground text-sm">{copy.description}</p>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={byDenomination}
          disabled={preview !== null}
          onChange={(event) => setByDenomination(event.target.checked)}
          className="accent-primary size-4"
        />
        {copy.byDenomination}
      </label>

      {byDenomination ? (
        <div className="space-y-3">
          <p className="text-muted-foreground text-sm">{copy.denominationsHint}</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {DENOMINATIONS_CENTS.map((denomination) => (
              <FormField
                key={denomination}
                label={`${copy.denomination} ${formatMoney(denomination)}`}
                htmlFor={`denomination-${denomination}`}
              >
                <input
                  id={`denomination-${denomination}`}
                  inputMode="numeric"
                  autoComplete="off"
                  disabled={preview !== null}
                  value={quantities[denomination] ?? ""}
                  onChange={(event) =>
                    setQuantities((current) => ({
                      ...current,
                      [denomination]: event.target.value.replace(/\D/g, "").slice(0, 6),
                    }))
                  }
                  className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full min-w-0 rounded-lg border px-2.5 py-1 text-right text-base tabular-nums outline-none focus-visible:ring-3 disabled:opacity-50 md:text-sm"
                />
              </FormField>
            ))}
          </div>
          <p className="text-sm">
            {copy.denominationsTotal}:{" "}
            <span className="font-semibold tabular-nums">{formatMoney(countedCents ?? 0)}</span>
          </p>
        </div>
      ) : (
        <div className="max-w-xs">
          <FormField label={copy.counted} htmlFor="counted-cash">
            <MoneyInput
              id="counted-cash"
              valueCents={totalCents}
              onValueChange={setTotalCents}
              disabled={preview !== null}
              placeholder="L 0.00"
            />
          </FormField>
        </div>
      )}

      {preview === null ? (
        <Button type="button" loading={pending} onClick={check}>
          {pending ? copy.checking : copy.check}
        </Button>
      ) : (
        <div className="space-y-4">
          <dl className="grid max-w-md grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
            <dt>{copy.expected}</dt>
            <dd className="text-right tabular-nums">{formatMoney(preview.expectedCents)}</dd>
            <dt>{copy.countedLabel}</dt>
            <dd className="text-right tabular-nums">{formatMoney(countedCents ?? 0)}</dd>
            <dt className="font-medium">{copy.difference}</dt>
            <dd
              className={cn(
                "text-right font-semibold tabular-nums",
                difference === 0 ? "text-success" : "text-destructive",
              )}
            >
              {formatMoney(difference)}
            </dd>
          </dl>
          <p
            role="status"
            className={cn(
              "text-sm font-medium",
              difference === 0 ? "text-success" : "text-warning",
            )}
          >
            {difference === 0
              ? copy.matches
              : `${difference > 0 ? copy.over : copy.short} ${formatMoney(Math.abs(difference))}`}
          </p>
          <FormField
            label={copy.notes}
            htmlFor="close-notes"
            hint={needsNotes ? copy.notesHintRequired : copy.notesHintOptional}
          >
            <textarea
              id="close-notes"
              rows={3}
              maxLength={500}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 w-full min-w-0 rounded-lg border px-2.5 py-1.5 text-base outline-none focus-visible:ring-3 md:text-sm"
            />
          </FormField>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={pending || !notesReady} onClick={close}>
              {pending ? copy.submitting : copy.submit}
            </Button>
            <Button
              type="button"
              variant="outline"
              loading={pending}
              onClick={() => {
                setPreview(null);
                setError(null);
              }}
            >
              {copy.recount}
            </Button>
          </div>
        </div>
      )}

      {error ? <Notice tone="error">{error}</Notice> : null}
    </section>
  );
}
