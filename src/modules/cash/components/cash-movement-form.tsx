"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { FormField } from "@/components/shared/form-field";
import { MoneyInput } from "@/components/shared/money-input";
import { NativeSelect } from "@/components/shared/native-select";
import { Notice } from "@/components/shared/notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { messages } from "@/config/messages.es";
import { addCashMovementAction } from "@/modules/cash/actions";
import type { CashActionState } from "@/modules/cash/types";

const copy = messages.cash.movements;

type FinanceCategoryOption = { id: string; name: string; type: "EXPENSE" | "INCOME" };

/**
 * `financeCategories` solo llega si el plan incluye Finanzas. Entonces una salida puede registrarse como gasto y una entrada
 * como ingreso, con su categoría; sin el módulo el formulario es el de siempre.
 */
export function CashMovementForm({
  financeCategories = null,
  onSaved,
}: {
  financeCategories?: readonly FinanceCategoryOption[] | null;
  /** Se llama después de guardar (el panel de Vender vuelve a cargar el turno). */
  onSaved?: () => void;
}) {
  const router = useRouter();
  const [type, setType] = useState<"IN" | "OUT">("OUT");
  const [amountCents, setAmountCents] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [asFinance, setAsFinance] = useState(true);
  const [categoryId, setCategoryId] = useState("");
  const [state, setState] = useState<CashActionState>(undefined);
  const [pending, startTransition] = useTransition();

  const kind = type === "OUT" ? "EXPENSE" : "INCOME";
  const options = (financeCategories ?? []).filter((category) => category.type === kind);
  const financeAvailable = options.length > 0;
  const registering = financeAvailable && asFinance;
  const selectedCategory = options.some((option) => option.id === categoryId)
    ? categoryId
    : (options[0]?.id ?? "");

  function changeType(next: "IN" | "OUT") {
    setType(next);
    // Una salida suele ser un gasto; una entrada suele ser más cambio: cada una arranca en su caso más común.
    setAsFinance(next === "OUT");
  }

  function submit() {
    setState(undefined);
    startTransition(async () => {
      const result = await addCashMovementAction({
        type,
        amountCents: amountCents ?? 0,
        reason,
        ...(registering ? { financeCategoryId: selectedCategory } : {}),
      });
      setState(result);
      if (result?.success) {
        setAmountCents(null);
        setReason("");
        router.refresh();
        onSaved?.();
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
              onChange={() => changeType(option)}
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

      {financeAvailable ? (
        <fieldset className="border-divider space-y-3 rounded-lg border p-3">
          <legend className="px-1 text-sm font-medium">{copy.finance.question}</legend>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {[true, false].map((value) => (
              <label key={String(value)} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="movement-finance"
                  checked={asFinance === value}
                  onChange={() => setAsFinance(value)}
                  className="accent-primary size-4"
                />
                {value
                  ? type === "OUT"
                    ? copy.finance.expense
                    : copy.finance.income
                  : type === "OUT"
                    ? copy.finance.withdrawal
                    : copy.finance.otherIn}
              </label>
            ))}
          </div>
          {registering ? (
            <FormField
              label={copy.finance.category}
              htmlFor="movement-category"
              hint={copy.finance.hint}
            >
              <NativeSelect
                id="movement-category"
                value={selectedCategory}
                onChange={(event) => setCategoryId(event.target.value)}
              >
                {options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          ) : null}
        </fieldset>
      ) : null}

      <Button type="button" loading={pending} onClick={submit}>
        {pending ? copy.submitting : copy.submit}
      </Button>
      {state?.error ? <Notice tone="error">{state.error}</Notice> : null}
      {state?.success ? <Notice tone="success">{state.success}</Notice> : null}
    </section>
  );
}
