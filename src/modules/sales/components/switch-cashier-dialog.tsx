"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { FormField } from "@/components/shared/form-field";
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
import { switchCashierAction } from "@/modules/auth/actions";

const copy = messages.pos.switch;

type SwitchCashierDialogProps = { open: boolean; onClose: () => void };

/** Cambio rápido de cajero: quien entra escribe su usuario y su PIN. El ticket armado no se toca. */
export function SwitchCashierDialog({ open, onClose }: SwitchCashierDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>{open ? <SwitchForm onClose={onClose} /> : null}</DialogContent>
    </Dialog>
  );
}

function SwitchForm({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await switchCashierAction({ username, pin });
      if (result.ok) {
        onClose();
        router.refresh();
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogDescription>{copy.description}</DialogDescription>
      </DialogHeader>
      <FormField label={copy.username} htmlFor="switch-username">
        <Input
          id="switch-username"
          autoFocus
          autoComplete="off"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
      </FormField>
      <FormField label={copy.pin} htmlFor="switch-pin">
        <Input
          id="switch-pin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          value={pin}
          onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
        />
      </FormField>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>
          {messages.common.close}
        </Button>
        <Button type="button" disabled={pending} onClick={submit}>
          {pending ? copy.submitting : copy.submit}
        </Button>
      </div>
    </>
  );
}
