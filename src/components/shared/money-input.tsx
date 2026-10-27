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
  /** Se llama con Enter, ya confirmado el monto (p. ej. para cobrar sin tocar el ratón). */
  onEnter?: () => void;
  /** Al enfocar, deja todo el texto seleccionado: lo que se escribe reemplaza al monto. */
  selectOnFocus?: boolean;
};

export function MoneyInput({
  valueCents,
  onValueChange,
  onEnter,
  selectOnFocus,
  className,
  onFocus,
  onBlur,
  onKeyDown,
  ...props
}: MoneyInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);

  const visible = draft ?? (valueCents === null ? "" : formatMoney(valueCents));

  /** Lee lo escrito: lo guarda si es un monto válido y marca el campo si no lo es. */
  function commit(): void {
    if (draft === null) {
      return;
    }
    if (draft.trim() === "") {
      onValueChange(null);
      setDraft(null);
      return;
    }
    const parsed = parseMoney(draft);
    if (parsed === null) {
      setInvalid(true);
    } else {
      onValueChange(parsed);
      setDraft(null);
    }
  }

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
        if (selectOnFocus) {
          // El texto cambia al enfocar ("L 250.00" pasa a "250.00"): se selecciona cuando ya cambió.
          const field = event.currentTarget;
          requestAnimationFrame(() => field.select());
        }
        onFocus?.(event);
      }}
      onChange={(event) => {
        setDraft(event.target.value);
        setInvalid(false);
      }}
      onBlur={(event) => {
        commit();
        onBlur?.(event);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && onEnter) {
          event.preventDefault();
          commit();
          // Después de que React aplique el monto confirmado.
          setTimeout(onEnter, 0);
        }
        onKeyDown?.(event);
      }}
    />
  );
}
