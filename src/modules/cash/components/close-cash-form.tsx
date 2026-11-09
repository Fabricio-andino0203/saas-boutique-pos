"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { FormField } from "@/components/shared/form-field";
import { MoneyInput } from "@/components/shared/money-input";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/shared/notice";
import { messages } from "@/config/messages.es";
import { formatMoney } from "@/lib/format";
import { mulCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { previewCashCloseAction, submitCashCloseAction } from "@/modules/cash/actions";
import {
  DENOMINATIONS_CENTS,
  sumDenominations,
  type DenominationCounts,
} from "@/modules/cash/schemas";

const copy = messages.cash.close;

type Preview = { expectedCents: number; differenceCents: number };

/** Lo que el cajero escribió en el conteo, como cantidades enteras (lo vacío o inválido es cero). */
function toCounts(quantities: Record<string, string>): DenominationCounts {
  const counts: DenominationCounts = {};
  for (const denomination of DENOMINATIONS_CENTS) {
    const value = Number(quantities[denomination]);
    counts[denomination] = Number.isInteger(value) && value > 0 ? value : 0;
  }
  return counts;
}

/**
 * El corte de caja en dos pasos: primero se cuentan los billetes y monedas (siempre así; el total se calcula solo) y se ve
 * la diferencia con lo esperado; después se indica cuánto se retira del cajón (el resto queda para abrir mañana), se
 * comenta (obligatorio si no cuadra) y se cierra. El servidor vuelve a calcular todo al cerrar. Con `financeBox` el retiro va
 * a la caja de finanzas.
 */
export function CloseCashForm({ financeBox = false }: { financeBox?: boolean }) {
  const router = useRouter();
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [withdrawCents, setWithdrawCents] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const counts = toCounts(quantities);
  const countedCents = sumDenominations(counts);
  const difference = preview?.differenceCents ?? 0;
  const needsNotes = preview !== null && difference !== 0;
  const notesReady = !needsNotes || notes.trim().length >= 3;
  const withdrawn = withdrawCents ?? 0;
  const withdrawTooMuch = withdrawn > countedCents;
  const leftInDrawer = countedCents - withdrawn;

  function check() {
    setError(null);
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
        countedCashCents: countedCents,
        withdrawnCents: withdrawn,
        denominations: counts,
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
    <section aria-label={copy.title} className="space-y-4">
      <ul className="divide-y rounded-lg border">
        {DENOMINATIONS_CENTS.map((denomination) => (
          <li
            key={denomination}
            className="grid grid-cols-[5.5rem_6rem_1fr] items-center gap-3 px-3 py-1.5"
          >
            <label htmlFor={`denomination-${denomination}`} className="text-sm tabular-nums">
              {formatMoney(denomination)}
            </label>
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
              className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-11 w-full min-w-0 rounded-lg border px-2.5 py-1 text-right text-base tabular-nums outline-none focus-visible:ring-3 disabled:opacity-50"
            />
            <span className="text-muted-foreground text-right text-sm tabular-nums">
              {formatMoney(mulCents(denomination, counts[denomination] ?? 0))}
            </span>
          </li>
        ))}
        <li className="flex items-center justify-between gap-3 px-3 py-2 font-medium">
          <span>{copy.denominationsTotal}</span>
          <span className="text-lg font-semibold tabular-nums">{formatMoney(countedCents)}</span>
        </li>
      </ul>

      {preview === null ? (
        <Button type="button" loading={pending} onClick={check}>
          {pending ? copy.checking : copy.check}
        </Button>
      ) : (
        <div className="space-y-4">
          <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
            <dt>{copy.expected}</dt>
            <dd className="text-right tabular-nums">{formatMoney(preview.expectedCents)}</dd>
            <dt>{copy.countedLabel}</dt>
            <dd className="text-right tabular-nums">{formatMoney(countedCents)}</dd>
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
          <fieldset className="border-divider space-y-3 rounded-lg border p-3">
            <legend className="px-1 text-sm font-medium">{copy.withdrawTitle}</legend>
            <div className="max-w-xs">
              <FormField
                label={copy.withdrawAmount}
                htmlFor="withdraw-cash"
                hint={financeBox ? copy.withdrawHintFinance : copy.withdrawHintPlain}
              >
                <MoneyInput
                  id="withdraw-cash"
                  valueCents={withdrawCents}
                  onValueChange={setWithdrawCents}
                  placeholder="L 0.00"
                />
              </FormField>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setWithdrawCents(countedCents)}
              >
                {copy.withdrawAll}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setWithdrawCents(0)}>
                {copy.withdrawNone}
              </Button>
            </div>
            <p
              role="status"
              className={cn("text-sm", withdrawTooMuch ? "text-destructive" : "font-medium")}
            >
              {withdrawTooMuch ? (
                copy.tooMuch
              ) : (
                <>
                  {copy.leftInDrawer}:{" "}
                  <span className="tabular-nums">{formatMoney(leftInDrawer)}</span>
                </>
              )}
            </p>
          </fieldset>
          <FormField
            label={copy.notes}
            htmlFor="close-notes"
            hint={needsNotes ? copy.notesHintRequired : undefined}
          >
            <textarea
              id="close-notes"
              rows={2}
              maxLength={500}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 w-full min-w-0 rounded-lg border px-2.5 py-1.5 text-base outline-none focus-visible:ring-3 md:text-sm"
            />
          </FormField>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={pending || !notesReady || withdrawTooMuch}
              onClick={close}
            >
              {pending ? copy.submitting : copy.submit}
            </Button>
            <Button
              type="button"
              variant="outline"
              loading={pending}
              onClick={() => {
                setPreview(null);
                setWithdrawCents(null);
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
