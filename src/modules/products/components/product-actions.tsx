"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { messages } from "@/config/messages.es";
import { duplicateProductAction, setProductArchivedAction } from "@/modules/products/actions";

const copy = messages.products.detail;

export function ProductActions({ productId, archived }: { productId: string; archived: boolean }) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<{ error?: string; success?: string } | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <section aria-label={messages.products.title} className="space-y-3">
      <div className="flex flex-wrap items-start gap-6">
        <div className="space-y-1">
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await duplicateProductAction(productId);
                if (result?.error) {
                  setFeedback(result);
                }
              })
            }
          >
            {copy.duplicate}
          </Button>
          <p className="text-muted-foreground max-w-xs text-xs">{copy.duplicateHint}</p>
        </div>
        <div className="space-y-1">
          <Button
            type="button"
            variant={archived ? "outline" : "destructive"}
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await setProductArchivedAction(productId, !archived);
                setFeedback(result ?? null);
                if (result?.success) {
                  router.refresh();
                }
              })
            }
          >
            {archived ? copy.restore : copy.archive}
          </Button>
          {archived ? null : (
            <p className="text-muted-foreground max-w-xs text-xs">{copy.archiveHint}</p>
          )}
        </div>
      </div>
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
    </section>
  );
}
