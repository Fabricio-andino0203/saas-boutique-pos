"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { FormField } from "@/components/shared/form-field";
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
import { voidBoxWithdrawalAction, voidFinanceEntryAction } from "@/modules/finance/actions";

const copy = messages.finance.void;

type VoidKind = "entry" | "withdrawal";

/**
 * «Anular» con su motivo. El movimiento (o el retiro de la caja de finanzas, con `kind="withdrawal"`) no se borra: queda
 * anulado y deja de sumar.
 */
export function VoidEntryButton({
  entryId,
  summary,
  kind = "entry",
}: {
  entryId: string;
  summary: string;
  kind?: VoidKind;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={`${copy.action}: ${summary}`}
        onClick={() => setOpen(true)}
      >
        {copy.action}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          {open ? (
            <VoidForm
              entryId={entryId}
              summary={summary}
              kind={kind}
              onClose={() => setOpen(false)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function VoidForm({
  entryId,
  summary,
  kind,
  onClose,
}: {
  entryId: string;
  summary: string;
  kind: VoidKind;
  onClose: () => void;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result =
        kind === "withdrawal"
          ? await voidBoxWithdrawalAction({ withdrawalId: entryId, reason })
          : await voidFinanceEntryAction({ entryId, reason });
      if (result.ok) {
        onClose();
        toast.success(messages.toasts.financeEntryVoided);
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
        <DialogDescription>
          {summary}. {copy.description}
        </DialogDescription>
      </DialogHeader>
      <FormField label={copy.reason} htmlFor="void-entry-reason" hint={copy.reasonHint}>
        <Input
          id="void-entry-reason"
          autoFocus
          autoComplete="off"
          maxLength={200}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </FormField>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          {messages.common.cancel}
        </Button>
        <Button type="submit" variant="destructive" loading={pending}>
          {pending ? copy.submitting : copy.submit}
        </Button>
      </div>
    </form>
  );
}
