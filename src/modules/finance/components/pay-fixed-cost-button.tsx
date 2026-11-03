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
import { payFixedCostAction } from "@/modules/finance/actions";
import { formatPeriod } from "@/modules/finance/periods";
import { MANUAL_PAYMENT_METHODS, type ManualPaymentMethod } from "@/modules/finance/schemas";

const copy = messages.finance.fixed;
const form = copy.payForm;

type PayFixedCostButtonProps = {
  fixedCostId: string;
  name: string;
  /** El mes que se paga (`2026-11`). */
  period: string;
  /** El monto habitual. */
  amountCents: number;
};

/** «Registrar pago» de un costo fijo en un mes: el gasto sale con los datos llenos. */
export function PayFixedCostButton(props: PayFixedCostButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        size="sm"
        aria-label={`${copy.pay}: ${props.name}, ${formatPeriod(props.period)}`}
        onClick={() => setOpen(true)}
      >
        {copy.pay}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          {open ? <PayForm {...props} onClose={() => setOpen(false)} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function PayForm({
  fixedCostId,
  name,
  period,
  amountCents: usual,
  onClose,
}: PayFixedCostButtonProps & { onClose: () => void }) {
  const router = useRouter();
  // Un identificador por formulario abierto: reintentar tras un corte no registra el pago dos veces.
  const [requestId] = useState(() => crypto.randomUUID());
  const today = localDateKey(new Date());
  const [amountCents, setAmountCents] = useState<number | null>(usual);
  const [date, setDate] = useState(today);
  const [paidWith, setPaidWith] = useState<ManualPaymentMethod>("TRANSFER");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await payFixedCostAction({
        fixedCostId,
        period,
        amountCents: amountCents ?? 0,
        occurredOn: date,
        paidWith,
        clientRequestId: requestId,
      });
      if (result.ok) {
        onClose();
        toast.success(messages.toasts.fixedCostPaid);
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
        <DialogTitle>{form.title}</DialogTitle>
        <DialogDescription>
          {name}, {formatPeriod(period)}. {form.description}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={form.amount} htmlFor="pay-amount">
          <MoneyInput
            id="pay-amount"
            valueCents={amountCents}
            onValueChange={setAmountCents}
            autoFocus
          />
        </FormField>
        <FormField label={form.date} htmlFor="pay-date">
          <Input
            id="pay-date"
            type="date"
            value={date}
            max={today}
            required
            onChange={(event) => setDate(event.target.value)}
          />
        </FormField>
        <FormField label={form.payment} htmlFor="pay-payment">
          <NativeSelect
            id="pay-payment"
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
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          {messages.common.cancel}
        </Button>
        <Button type="submit" loading={pending}>
          {pending ? form.submitting : form.submit}
        </Button>
      </div>
    </form>
  );
}
