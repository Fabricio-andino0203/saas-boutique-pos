"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { FormField } from "@/components/shared/form-field";
import { MoneyInput } from "@/components/shared/money-input";
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
import { formatMoney } from "@/lib/format";
import { createBoxWithdrawalAction } from "@/modules/finance/actions";

const copy = messages.finance.box.withdraw;

/** «Retirar de la caja»: el efectivo que se lleva el dueño o se deposita en el banco. No es un gasto. */
export function BoxWithdrawalButton({ balanceCents }: { balanceCents: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        {copy.action}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          {open ? (
            <WithdrawalForm balanceCents={balanceCents} onClose={() => setOpen(false)} />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function WithdrawalForm({ balanceCents, onClose }: { balanceCents: number; onClose: () => void }) {
  const router = useRouter();
  // Un identificador por formulario abierto: reintentar tras un corte no duplica el retiro.
  const [requestId] = useState(() => crypto.randomUUID());
  const today = localDateKey(new Date());
  const [date, setDate] = useState(today);
  const [amountCents, setAmountCents] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await createBoxWithdrawalAction({
        amountCents: amountCents ?? 0,
        occurredOn: date,
        reason,
        clientRequestId: requestId,
      });
      if (result.ok) {
        onClose();
        toast.success(messages.toasts.financeBoxWithdrawn);
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
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogDescription>{copy.description}</DialogDescription>
      </DialogHeader>

      <p className="text-sm">
        {copy.balance}:{" "}
        <span className="font-semibold tabular-nums">{formatMoney(balanceCents)}</span>
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={copy.date} htmlFor="withdrawal-date">
          <Input
            id="withdrawal-date"
            type="date"
            value={date}
            max={today}
            required
            onChange={(event) => setDate(event.target.value)}
          />
        </FormField>
        <FormField label={copy.amount} htmlFor="withdrawal-amount">
          <MoneyInput
            id="withdrawal-amount"
            valueCents={amountCents}
            onValueChange={setAmountCents}
            autoFocus
          />
        </FormField>
      </div>

      <FormField label={copy.reason} htmlFor="withdrawal-reason" hint={copy.reasonHint}>
        <Input
          id="withdrawal-reason"
          autoComplete="off"
          maxLength={200}
          value={reason}
          required
          onChange={(event) => setReason(event.target.value)}
        />
      </FormField>

      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          {messages.common.cancel}
        </Button>
        <Button type="submit" loading={pending}>
          {pending ? copy.submitting : copy.submit}
        </Button>
      </div>
    </form>
  );
}
