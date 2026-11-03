"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { FormField } from "@/components/shared/form-field";
import { MoneyInput } from "@/components/shared/money-input";
import { NativeSelect } from "@/components/shared/native-select";
import { Notice } from "@/components/shared/notice";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { messages } from "@/config/messages.es";
import { localDateKey } from "@/lib/dates";
import { createFinanceEntryAction } from "@/modules/finance/actions";
import {
  MANUAL_PAYMENT_METHODS,
  type FinanceType,
  type ManualPaymentMethod,
} from "@/modules/finance/schemas";

const copy = messages.finance.form;

type Option = { id: string; name: string };

type NewEntryButtonProps = {
  type: FinanceType;
  categories: readonly Option[];
  suppliers: readonly Option[];
};

/** Botón «Nuevo gasto» o «Nuevo ingreso» que abre el formulario en una ventana. */
export function NewEntryButton({ type, categories, suppliers }: NewEntryButtonProps) {
  const [open, setOpen] = useState(false);
  const label =
    type === "EXPENSE" ? messages.finance.entries.newExpense : messages.finance.entries.newIncome;
  return (
    <>
      <Button
        type="button"
        variant={type === "EXPENSE" ? "default" : "outline"}
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          {open ? (
            <EntryForm
              type={type}
              categories={categories}
              suppliers={suppliers}
              onClose={() => setOpen(false)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function EntryForm({
  type,
  categories,
  suppliers,
  onClose,
}: NewEntryButtonProps & { onClose: () => void }) {
  const router = useRouter();
  // Un identificador por formulario abierto: reintentar tras un corte no duplica el movimiento.
  const [requestId] = useState(() => crypto.randomUUID());
  const today = localDateKey(new Date());
  const [date, setDate] = useState(today);
  const [amountCents, setAmountCents] = useState<number | null>(null);
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [paidWith, setPaidWith] = useState<ManualPaymentMethod>("CASH_OTHER");
  const [details, setDetails] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const expense = type === "EXPENSE";

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await createFinanceEntryAction({
        type,
        categoryId,
        amountCents: amountCents ?? 0,
        occurredOn: date,
        paidWith,
        description: details,
        supplierId: expense ? supplierId : "",
        clientRequestId: requestId,
      });
      if (result.ok) {
        onClose();
        toast.success(messages.toasts.financeEntryCreated);
        router.refresh();
      } else {
        setError(result.error.message);
      }
    });
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <DialogHeader>
        <DialogTitle>{expense ? copy.titleExpense : copy.titleIncome}</DialogTitle>
        <DialogDescription>
          {expense ? copy.descriptionExpense : copy.descriptionIncome}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={copy.date} htmlFor="entry-date">
          <Input
            id="entry-date"
            type="date"
            value={date}
            max={today}
            required
            onChange={(event) => setDate(event.target.value)}
          />
        </FormField>
        <FormField label={copy.amount} htmlFor="entry-amount">
          <MoneyInput
            id="entry-amount"
            valueCents={amountCents}
            onValueChange={setAmountCents}
            autoFocus
          />
        </FormField>
        <FormField label={copy.category} htmlFor="entry-category">
          <NativeSelect
            id="entry-category"
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
            required
          >
            {categories.length === 0 ? <option value="">{copy.noCategories}</option> : null}
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label={copy.payment} htmlFor="entry-payment">
          <NativeSelect
            id="entry-payment"
            value={paidWith}
            onChange={(event) => setPaidWith(event.target.value as ManualPaymentMethod)}
          >
            {MANUAL_PAYMENT_METHODS.map((method) => (
              <option key={method} value={method}>
                {messages.finance.payments[method]}
              </option>
            ))}
          </NativeSelect>
        </FormField>
      </div>

      <FormField label={copy.details} htmlFor="entry-details" hint={copy.detailsHint}>
        <Input
          id="entry-details"
          autoComplete="off"
          maxLength={200}
          value={details}
          required
          onChange={(event) => setDetails(event.target.value)}
        />
      </FormField>

      {expense && suppliers.length > 0 ? (
        <FormField label={copy.supplier} htmlFor="entry-supplier">
          <NativeSelect
            id="entry-supplier"
            value={supplierId}
            onChange={(event) => setSupplierId(event.target.value)}
          >
            <option value="">{copy.noSupplier}</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
      ) : null}

      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          {messages.common.cancel}
        </Button>
        <Button type="submit" loading={pending} disabled={categories.length === 0}>
          {pending ? copy.submitting : copy.submit}
        </Button>
      </div>
    </form>
  );
}
