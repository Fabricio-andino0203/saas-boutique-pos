"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { messages } from "@/config/messages.es";
import { cancelPurchaseOrderAction, placePurchaseOrderAction } from "@/modules/purchasing/actions";
import type { PurchasingActionState } from "@/modules/purchasing/schemas";

const copy = messages.purchasing;

type OrderActionsProps = {
  orderId: string;
  status: "DRAFT" | "ORDERED" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CANCELLED";
  canOrder: boolean;
};

/** Los botones que corresponden al estado de la orden. */
export function OrderActions({ orderId, status, canOrder }: OrderActionsProps) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<PurchasingActionState>(undefined);
  const [pending, startTransition] = useTransition();

  const run = (action: (id: string) => Promise<PurchasingActionState>) =>
    startTransition(async () => {
      const result = await action(orderId);
      setFeedback(result);
      if (result?.success) {
        router.refresh();
      }
    });

  const canReceive = status === "ORDERED" || status === "PARTIALLY_RECEIVED";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {canReceive ? (
          <Link href={`/compras/recepciones/nueva?orden=${orderId}`} className={buttonVariants()}>
            {copy.receive}
          </Link>
        ) : null}
        {status === "DRAFT" && canOrder ? (
          <>
            <Button type="button" disabled={pending} onClick={() => run(placePurchaseOrderAction)}>
              {copy.order.place}
            </Button>
            <Link
              href={`/compras/${orderId}/editar`}
              className={buttonVariants({ variant: "outline" })}
            >
              {copy.order.edit}
            </Link>
          </>
        ) : null}
        {(status === "DRAFT" || status === "ORDERED") && canOrder ? (
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={() => run(cancelPurchaseOrderAction)}
          >
            {copy.order.cancel}
          </Button>
        ) : null}
      </div>
      {status === "DRAFT" ? (
        <p className="text-muted-foreground text-sm">{copy.order.draftHint}</p>
      ) : null}
      {feedback?.error ? (
        <p role="alert" className="text-destructive text-sm">
          {feedback.error}
        </p>
      ) : null}
      {feedback?.success ? (
        <p role="status" className="text-success text-sm">
          {feedback.success}
        </p>
      ) : null}
    </div>
  );
}
