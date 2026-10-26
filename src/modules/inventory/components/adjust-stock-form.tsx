"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { FormField } from "@/components/shared/form-field";
import { NativeSelect } from "@/components/shared/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { messages } from "@/config/messages.es";
import { adjustStockAction } from "@/modules/inventory/actions";
import { ADJUSTMENT_REASONS } from "@/modules/inventory/reasons";
import type { InventoryActionState } from "@/modules/inventory/types";

const copy = messages.inventory.adjust;

type Mode = "in" | "out" | "set";

/** Cuántas prendas quedarían tras el ajuste, para que nadie se sorprenda (el servidor decide al guardar). */
function previewOnHand(mode: Mode, current: number, quantity: number): number {
  return mode === "in" ? current + quantity : mode === "out" ? current - quantity : quantity;
}

export function AdjustStockForm({ variantId, onHand }: { variantId: string; onHand: number }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("in");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [state, setState] = useState<InventoryActionState>(undefined);
  const [pending, startTransition] = useTransition();

  const parsed = quantity.trim() === "" ? null : Number(quantity);
  const validQuantity = parsed !== null && Number.isInteger(parsed) && parsed >= 0;

  function submit() {
    setState(undefined);
    startTransition(async () => {
      const result = await adjustStockAction({
        variantId,
        mode,
        quantity: parsed === null ? Number.NaN : parsed,
        reason,
        note,
      });
      setState(result);
      if (result?.success) {
        setQuantity("");
        setReason("");
        setNote("");
        router.refresh();
      }
    });
  }

  return (
    <section aria-labelledby="adjust-title" className="bg-card space-y-4 rounded-lg border p-4">
      <div className="space-y-1">
        <h2 id="adjust-title" className="text-lg font-medium">
          {copy.title}
        </h2>
        <p className="text-muted-foreground text-sm">{copy.description}</p>
      </div>

      <fieldset className="flex flex-wrap gap-x-6 gap-y-2">
        <legend className="mb-1 text-sm font-medium">{copy.what}</legend>
        {(["in", "out", "set"] as const).map((option) => (
          <label key={option} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="adjust-mode"
              value={option}
              checked={mode === option}
              onChange={() => setMode(option)}
              className="accent-primary size-4"
            />
            {copy.modes[option]}
          </label>
        ))}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label={copy.quantity} htmlFor="adjust-quantity">
          <Input
            id="adjust-quantity"
            type="number"
            min={mode === "set" ? 0 : 1}
            step={1}
            inputMode="numeric"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </FormField>
        <FormField label={copy.reason} htmlFor="adjust-reason">
          <NativeSelect
            id="adjust-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          >
            <option value="">{copy.chooseReason}</option>
            {ADJUSTMENT_REASONS.map((code) => (
              <option key={code} value={code}>
                {copy.reasons[code]}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label={copy.note} htmlFor="adjust-note">
          <Input
            id="adjust-note"
            autoComplete="off"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </FormField>
      </div>

      {validQuantity ? (
        <p className="text-muted-foreground text-sm">
          {copy.preview}{" "}
          <span className="text-foreground font-medium tabular-nums">
            {previewOnHand(mode, onHand, parsed)}
          </span>
          .
        </p>
      ) : null}
      {state?.error ? (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      ) : null}
      {state?.success ? (
        <p role="status" className="text-success text-sm">
          {state.success}
        </p>
      ) : null}
      <Button type="button" disabled={pending} onClick={submit}>
        {pending ? copy.submitting : copy.submit}
      </Button>
    </section>
  );
}
