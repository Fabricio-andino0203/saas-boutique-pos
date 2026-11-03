"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Notice } from "@/components/shared/notice";
import { Button } from "@/components/ui/button";
import { messages } from "@/config/messages.es";
import { setFixedCostArchivedAction } from "@/modules/finance/actions";

const copy = messages.finance.fixed;

/** Archiva o restaura un costo fijo. Los pagos que ya tiene no cambian. */
export function ArchiveFixedCostButton({
  fixedCostId,
  name,
  archived,
}: {
  fixedCostId: string;
  name: string;
  archived: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const label = archived ? copy.restore : copy.archive;

  function toggle() {
    setError(null);
    startTransition(async () => {
      const result = await setFixedCostArchivedAction(fixedCostId, !archived);
      if (result.ok) {
        toast.success(
          archived ? messages.toasts.fixedCostRestored : messages.toasts.fixedCostArchived,
        );
        router.refresh();
      } else {
        setError(result.error.message);
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        loading={pending}
        aria-label={`${label}: ${name}`}
        onClick={toggle}
      >
        {label}
      </Button>
      {error ? (
        <Notice tone="error" size="sm" className="mt-1">
          {error}
        </Notice>
      ) : null}
    </>
  );
}
