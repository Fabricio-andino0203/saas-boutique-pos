"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Notice } from "@/components/shared/notice";
import { messages } from "@/config/messages.es";
import { setCustomerArchivedAction } from "@/modules/customers/actions";

const copy = messages.customers.actions;

/** Archiva o restaura al cliente. Solo la ven quienes pueden; el servidor lo vuelve a revisar. */
export function ArchiveCustomerButton({ id, archived }: { id: string; archived: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle() {
    setError(null);
    startTransition(async () => {
      const result = await setCustomerArchivedAction(id, !archived);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      toast.success(archived ? messages.toasts.customerRestored : messages.toasts.customerArchived);
      router.refresh();
    });
  }

  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant={archived ? "outline" : "destructive"}
        loading={pending}
        onClick={toggle}
      >
        {archived ? copy.restore : copy.archive}
      </Button>
      {archived ? null : <p className="text-muted-foreground text-xs">{copy.archiveHint}</p>}
      {error ? <Notice tone="error">{error}</Notice> : null}
    </div>
  );
}
