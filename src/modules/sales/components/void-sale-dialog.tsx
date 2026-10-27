"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { FormField } from "@/components/shared/form-field";
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
import { voidSaleAction } from "@/modules/sales/history-actions";

const copy = messages.salesHistory.void;

type VoidSaleDialogProps = {
  saleId: string;
  number: string;
  /** El cajero no puede anular solo: necesita el usuario y el PIN de un gerente. */
  needsManager: boolean;
};

export function VoidSaleDialog({ saleId, number, needsManager }: VoidSaleDialogProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="destructive" onClick={() => setOpen(true)}>
        {copy.action}
      </Button>
      <Dialog open={open} onOpenChange={(next) => setOpen(next)}>
        <DialogContent>
          {open ? (
            <VoidForm
              saleId={saleId}
              number={number}
              needsManager={needsManager}
              onClose={() => setOpen(false)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function VoidForm({
  saleId,
  number,
  needsManager,
  onClose,
}: VoidSaleDialogProps & { onClose: () => void }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await voidSaleAction({
        saleId,
        reason,
        ...(needsManager ? { managerOverride: { username, pin } } : {}),
      });
      if (result.ok) {
        onClose();
        router.refresh();
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {copy.title} {number}
        </DialogTitle>
        <DialogDescription>{copy.description}</DialogDescription>
      </DialogHeader>
      <FormField label={copy.reason} htmlFor="void-reason">
        <Input
          id="void-reason"
          autoFocus
          autoComplete="off"
          maxLength={200}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </FormField>
      {needsManager ? (
        <fieldset className="bg-warning/10 space-y-3 rounded-lg border p-3">
          <legend className="px-1 text-sm font-medium">{copy.managerTitle}</legend>
          <p className="text-sm">{copy.managerHint}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label={copy.managerUsername} htmlFor="void-username">
              <Input
                id="void-username"
                autoComplete="off"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </FormField>
            <FormField label={copy.managerPin} htmlFor="void-pin">
              <Input
                id="void-pin"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={6}
                value={pin}
                onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
              />
            </FormField>
          </div>
        </fieldset>
      ) : null}
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>
          {messages.common.close}
        </Button>
        <Button type="button" variant="destructive" disabled={pending} onClick={submit}>
          {pending ? copy.submitting : copy.submit}
        </Button>
      </div>
    </>
  );
}
