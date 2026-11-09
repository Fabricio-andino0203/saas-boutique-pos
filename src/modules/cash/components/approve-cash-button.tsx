"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Notice } from "@/components/shared/notice";
import { messages } from "@/config/messages.es";
import { approveCashCloseAction } from "@/modules/cash/actions";
import type { CashActionState } from "@/modules/cash/types";

const copy = messages.cash.approve;

export function ApproveCashButton({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [state, setState] = useState<CashActionState>(undefined);
  const [pending, startTransition] = useTransition();

  function approve() {
    setState(undefined);
    startTransition(async () => {
      const result = await approveCashCloseAction(sessionId);
      setState(result);
      if (result?.success) {
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-2">
      <Button type="button" loading={pending} onClick={approve}>
        {pending ? copy.approving : copy.action}
      </Button>
      {state?.error ? <Notice tone="error">{state.error}</Notice> : null}
      {state?.success ? <Notice tone="success">{state.success}</Notice> : null}
    </div>
  );
}
