"use client";

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
import { formatMoney, pluralize } from "@/lib/format";
import type { CartItem } from "@/modules/sales/cart-logic";
import { cancelTicketAction } from "@/modules/sales/pos-actions";

const copy = messages.pos.cancel;

/** El ticket que se va a descartar: el de la pantalla o uno de los que están en espera. */
export type CancelTarget = {
  source: "current" | "parked";
  items: CartItem[];
  /** Lo que valía el ticket, para mostrarlo (el registro lo calcula el servidor). */
  totalCents: number;
};

type CancelTicketDialogProps = {
  target: CancelTarget | null;
  onClose: () => void;
  /** Ya quedó anotado en la auditoría: ahora sí se descarta el ticket. */
  onCancelled: () => void;
};

/**
 * Descartar un ticket antes de cobrarlo pide un motivo y deja constancia (quién, por qué y qué tenía): nada se quita del
 * mostrador sin explicación ni registro.
 */
export function CancelTicketDialog({ target, onClose, onCancelled }: CancelTicketDialogProps) {
  return (
    <Dialog open={target !== null} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        {target ? <CancelForm target={target} onClose={onClose} onCancelled={onCancelled} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function CancelForm({
  target,
  onClose,
  onCancelled,
}: {
  target: CancelTarget;
  onClose: () => void;
  onCancelled: () => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const units = target.items.reduce((total, item) => total + item.quantity, 0);

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await cancelTicketAction({
        reason,
        source: target.source,
        lines: target.items.map((item) => ({
          productName: item.productName,
          variantLabel: item.variantLabel,
          quantity: item.quantity,
          unitPriceCents: item.unitPriceCents,
        })),
      });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      toast.success(copy.done);
      onCancelled();
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogDescription>
          {units} {pluralize(units, messages.pos.ticket.unit, messages.pos.ticket.units)} ·{" "}
          {formatMoney(target.totalCents)}
        </DialogDescription>
      </DialogHeader>
      <FormField label={copy.reason} htmlFor="cancel-reason">
        <Input
          id="cancel-reason"
          autoFocus
          autoComplete="off"
          maxLength={200}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && reason.trim().length >= 3 && !pending) {
              event.preventDefault();
              confirm();
            }
          }}
        />
      </FormField>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          {copy.keep}
        </Button>
        <Button
          type="button"
          variant="destructive"
          loading={pending}
          disabled={reason.trim().length < 3}
          onClick={confirm}
        >
          {pending ? copy.confirming : copy.confirm}
        </Button>
      </div>
    </>
  );
}
