"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { messages } from "@/config/messages.es";
import {
  applyCountAction,
  cancelCountAction,
  reopenCountAction,
  submitCountAction,
} from "@/modules/inventory/count-actions";
import type { InventoryActionState } from "@/modules/inventory/types";

const copy = messages.counts.actions;

type CountActionsProps = {
  countId: string;
  status: "OPEN" | "IN_REVIEW" | "APPLIED" | "CANCELLED";
  canApprove: boolean;
};

/** Los botones que corresponden al estado del conteo. */
export function CountActions({ countId, status, canApprove }: CountActionsProps) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<InventoryActionState>(undefined);
  const [pending, startTransition] = useTransition();

  const run = (action: (id: string) => Promise<InventoryActionState>) =>
    startTransition(async () => {
      const result = await action(countId);
      setFeedback(result);
      if (result?.success) {
        router.refresh();
      }
    });

  if (status === "APPLIED" || status === "CANCELLED") {
    return null;
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {status === "OPEN" ? (
          <Button type="button" disabled={pending} onClick={() => run(submitCountAction)}>
            {copy.review}
          </Button>
        ) : (
          <>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => run(reopenCountAction)}
            >
              {copy.reopen}
            </Button>
            {canApprove ? (
              <Button type="button" disabled={pending} onClick={() => run(applyCountAction)}>
                {pending ? copy.approving : copy.approve}
              </Button>
            ) : null}
          </>
        )}
        <Button
          type="button"
          variant="destructive"
          disabled={pending}
          onClick={() => run(cancelCountAction)}
        >
          {copy.cancel}
        </Button>
      </div>
      {status === "IN_REVIEW" && !canApprove ? (
        <p className="text-muted-foreground text-sm">{copy.needManager}</p>
      ) : null}
      <p className="text-muted-foreground text-xs">{copy.cancelHint}</p>
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
