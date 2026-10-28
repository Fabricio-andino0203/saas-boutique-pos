"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
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
      router.refresh();
    });
  }

  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant={archived ? "outline" : "destructive"}
        disabled={pending}
        onClick={toggle}
      >
        {archived ? copy.restore : copy.archive}
      </Button>
      {archived ? null : <p className="text-muted-foreground text-xs">{copy.archiveHint}</p>}
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
