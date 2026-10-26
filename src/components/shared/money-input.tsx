"use client";

import { useState, type ComponentProps } from "react";

import { Input } from "@/components/ui/input";
import { formatMoney, formatMoneyPlain, parseMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

type MoneyInputProps = Omit<
  ComponentProps<"input">,
  "value" | "defaultValue" | "onChange" | "type"
> & {
  valueCents: number | null;
  onValueChange: (cents: number | null) => void;
};

export function MoneyInput({
  valueCents,
  onValueChange,
  className,
  onFocus,
  onBlur,
  ...props
}: MoneyInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);

  const visible = draft ?? (valueCents === null ? "" : formatMoney(valueCents));

  return (
    <Input
      {...props}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={visible}
      aria-invalid={invalid ? "true" : undefined}
      className={cn("text-right tabular-nums", className)}
      onFocus={(event) => {
        setDraft(valueCents === null ? "" : formatMoneyPlain(valueCents));
        setInvalid(false);
        onFocus?.(event);
      }}
      onChange={(event) => {
        setDraft(event.target.value);
        setInvalid(false);
      }}
      onBlur={(event) => {
        if (draft !== null) {
          if (draft.trim() === "") {
            onValueChange(null);
            setDraft(null);
          } else {
            const parsed = parseMoney(draft);
            if (parsed === null) {
              setInvalid(true);
            } else {
              onValueChange(parsed);
              setDraft(null);
            }
          }
        }
        onBlur?.(event);
      }}
    />
  );
}
