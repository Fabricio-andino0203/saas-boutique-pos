"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { messages } from "@/config/messages.es";
import { loadSampleDataAction } from "@/modules/settings/actions";
import type { SettingsActionState } from "@/modules/settings/schemas";

const copy = messages.settings.sample;

export function SampleDataButton({ alreadyLoaded }: { alreadyLoaded: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<SettingsActionState>(
    alreadyLoaded ? { success: copy.already } : undefined,
  );
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(true)}>
        {pending ? copy.loading : copy.button}
      </Button>
      {result?.error ? (
        <p role="alert" className="text-destructive text-sm">
          {result.error}
        </p>
      ) : null}
      {result?.success ? (
        <p role="status" className="text-success text-sm">
          {result.success}
        </p>
      ) : null}
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={copy.confirmTitle}
        description={copy.confirmText}
        confirmLabel={copy.button}
        pending={pending}
        onConfirm={() => {
          setOpen(false);
          startTransition(async () => {
            setResult(await loadSampleDataAction());
            router.refresh();
          });
        }}
      />
    </div>
  );
}
