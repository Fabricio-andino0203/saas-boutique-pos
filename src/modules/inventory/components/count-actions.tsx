"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Notice } from "@/components/shared/notice";
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
          <Button type="button" loading={pending} onClick={() => run(submitCountAction)}>
            {copy.review}
          </Button>
        ) : (
          <>
            <Button
              type="button"
              variant="outline"
              loading={pending}
              onClick={() => run(reopenCountAction)}
            >
              {copy.reopen}
            </Button>
            {canApprove ? (
              <Button type="button" loading={pending} onClick={() => run(applyCountAction)}>
                {pending ? copy.approving : copy.approve}
              </Button>
            ) : null}
          </>
        )}
        <Button
          type="button"
          variant="destructive"
          loading={pending}
          onClick={() => run(cancelCountAction)}
        >
          {copy.cancel}
        </Button>
      </div>
      {status === "IN_REVIEW" && !canApprove ? (
        <p className="text-muted-foreground text-sm">{copy.needManager}</p>
      ) : null}
      <p className="text-muted-foreground text-xs">{copy.cancelHint}</p>
      {feedback?.error ? <Notice tone="error">{feedback.error}</Notice> : null}
      {feedback?.success ? <Notice tone="success">{feedback.success}</Notice> : null}
    </div>
  );
}
