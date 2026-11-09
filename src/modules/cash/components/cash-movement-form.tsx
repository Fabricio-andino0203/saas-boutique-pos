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

export type FinanceCategoryOption = { id: string; name: string; type: "EXPENSE" | "INCOME" };

export type MovementKind = "in" | "out" | "expense";

/**
 * Una forma de mover efectivo del cajón, siempre con su motivo: ingresar, retirar o agregar un gasto. `financeCategories`
 * solo llega si el plan incluye Finanzas: el gasto elige su categoría (queda también en Finanzas) y una entrada puede
 * registrarse como un ingreso que no es una venta.
 */
export function CashMovementForm({
  kind,
  financeCategories = null,
  onSaved,
}: {
  kind: MovementKind;
  financeCategories?: readonly FinanceCategoryOption[] | null;
  /** Se llama después de guardar (el panel de Vender vuelve a cargar el turno). */
  onSaved?: () => void;
}) {
  const router = useRouter();
  const [amountCents, setAmountCents] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [state, setState] = useState<CashActionState>(undefined);
  const [pending, startTransition] = useTransition();

  const options = (financeCategories ?? []).filter(
    (category) => category.type === (kind === "expense" ? "EXPENSE" : "INCOME"),
  );
  // Un gasto siempre lleva categoría; una entrada puede ser solo efectivo ("").
  const showCategory =
    kind === "expense" ? options.length > 0 : kind === "in" && options.length > 0;
  const selectedCategory = options.some((option) => option.id === categoryId)
    ? categoryId
    : kind === "expense"
      ? (options[0]?.id ?? "")
      : "";

  function submit() {
    setState(undefined);
    startTransition(async () => {
      const result = await addCashMovementAction({
        type: kind === "in" ? "IN" : "OUT",
        amountCents: amountCents ?? 0,
        reason,
        ...(showCategory && selectedCategory ? { financeCategoryId: selectedCategory } : {}),
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
    <section aria-label={copy.forms[kind]} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
        <FormField label={copy.amount} htmlFor="movement-amount">
          <MoneyInput
            id="movement-amount"
            valueCents={amountCents}
            onValueChange={setAmountCents}
            placeholder="L 0.00"
          />
        </FormField>
        <FormField label={copy.reason} htmlFor="movement-reason">
          <Input
            id="movement-reason"
            value={reason}
            maxLength={200}
            onChange={(event) => setReason(event.target.value)}
          />
        </FormField>
      </div>

      {showCategory ? (
        <FormField
          label={kind === "expense" ? copy.finance.category : copy.finance.registerAs}
          htmlFor="movement-category"
        >
          <NativeSelect
            id="movement-category"
            value={selectedCategory}
            onChange={(event) => setCategoryId(event.target.value)}
          >
            {kind === "in" ? <option value="">{copy.finance.cashOnly}</option> : null}
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
      ) : null}

      <Button type="button" loading={pending} onClick={submit}>
        {pending ? copy.submitting : copy.submit}
      </Button>
      {state?.error ? <Notice tone="error">{state.error}</Notice> : null}
      {state?.success ? <Notice tone="success">{state.success}</Notice> : null}
    </section>
  );
}
