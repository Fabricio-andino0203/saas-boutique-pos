"use client";

import { useState } from "react";

import { FormField } from "@/components/shared/form-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/shared/notice";
import { messages } from "@/config/messages.es";
import {
  formatMoney,
  formatMoneyPlain,
  formatPercentBps,
  parseMoney,
  parsePercentBps,
} from "@/lib/format";
import { discountExceedsLimit } from "@/modules/sales/calc";
import type { CartItem } from "@/modules/sales/cart-logic";
import type { PosConfig } from "@/modules/sales/pos-types";
import type { Discount } from "@/modules/sales/schemas";

const copy = messages.pos.discount;

type Scope = "ALL" | "LINE";

type DiscountDialogProps = {
  open: boolean;
  config: PosConfig;
  selected: CartItem | null;
  /** Lo que se descuenta si es a toda la venta: el subtotal con los descuentos de línea. */
  saleBaseCents: number;
  current: Discount | undefined;
  onApply: (scope: Scope, discount: Discount | undefined) => void;
  onClose: () => void;
};

function describe(discount: Discount | undefined): { type: "PERCENT" | "AMOUNT"; value: string } {
  if (!discount) {
    return { type: "PERCENT", value: "" };
  }
  return discount.type === "PERCENT"
    ? { type: "PERCENT", value: formatPercentBps(discount.bps) }
    : { type: "AMOUNT", value: formatMoneyPlain(discount.cents) };
}

/**
 * Descuento a toda la venta o a la línea seleccionada, en porcentaje o en lempiras. Avisa si pasa del límite del
 * cajero: el servidor decide al cobrar y pedirá el PIN de un gerente.
 */
export function DiscountDialog(props: DiscountDialogProps) {
  // Se vuelve a armar cada vez que se abre, para que no queden valores de la vez anterior.
  return (
    <Dialog open={props.open} onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent>{props.open ? <DiscountForm {...props} /> : null}</DialogContent>
    </Dialog>
  );
}

function DiscountForm({
  config,
  selected,
  saleBaseCents,
  current,
  onApply,
  onClose,
}: DiscountDialogProps) {
  const [scope, setScope] = useState<Scope>(selected ? "LINE" : "ALL");
  const base = describe(scope === "LINE" ? selected?.discount : current);
  const [type, setType] = useState<"PERCENT" | "AMOUNT">(base.type);
  const [value, setValue] = useState(base.value);
  const [error, setError] = useState<string | null>(null);

  const baseCents =
    scope === "LINE" && selected ? selected.unitPriceCents * selected.quantity : saleBaseCents;

  function parse(): Discount | null {
    if (type === "PERCENT") {
      const bps = parsePercentBps(value);
      return bps !== null && bps >= 1 && bps <= 10000 ? { type: "PERCENT", bps } : null;
    }
    const cents = parseMoney(value);
    return cents !== null && cents >= 1 ? { type: "AMOUNT", cents } : null;
  }

  const parsed = parse();
  const over =
    parsed !== null &&
    !config.canDiscountBeyondLimit &&
    discountExceedsLimit(parsed, baseCents, config.cashierDiscountPercent);

  function apply() {
    if (!parsed) {
      setError(copy.invalid);
      return;
    }
    if (parsed.type === "AMOUNT" && parsed.cents > baseCents) {
      setError(copy.tooBig);
      return;
    }
    onApply(scope, parsed);
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{copy.title}</DialogTitle>
      </DialogHeader>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">{copy.scope}</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="discount-scope"
            checked={scope === "ALL"}
            onChange={() => setScope("ALL")}
            className="accent-primary size-4"
          />
          {copy.scopeAll}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="discount-scope"
            checked={scope === "LINE"}
            disabled={!selected}
            onChange={() => setScope("LINE")}
            className="accent-primary size-4"
          />
          {copy.scopeLine}
          {selected ? `: ${selected.productName} ${selected.variantLabel}`.trimEnd() : ""}
        </label>
        {!selected ? <p className="text-muted-foreground text-sm">{copy.noLine}</p> : null}
      </fieldset>

      <fieldset className="flex flex-wrap gap-x-6 gap-y-2">
        <legend className="mb-1 text-sm font-medium">{copy.type}</legend>
        {(
          [
            ["PERCENT", copy.percent],
            ["AMOUNT", copy.amount],
          ] as const
        ).map(([option, label]) => (
          <label key={option} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="discount-type"
              checked={type === option}
              onChange={() => {
                setType(option);
                setValue("");
                setError(null);
              }}
              className="accent-primary size-4"
            />
            {label}
          </label>
        ))}
      </fieldset>

      <FormField label={copy.value} htmlFor="discount-value">
        <Input
          id="discount-value"
          inputMode="decimal"
          autoComplete="off"
          autoFocus
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              apply();
            }
          }}
          className="text-right tabular-nums"
        />
      </FormField>

      <p className="text-muted-foreground text-sm">
        {config.canDiscountBeyondLimit
          ? copy.limitManager
          : `${copy.limit} ${config.cashierDiscountPercent} %.`}{" "}
        {parsed?.type === "AMOUNT" ? `(${formatMoney(parsed.cents)})` : null}
      </p>
      {over ? <Notice tone="warning">{copy.overLimit}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => onApply(scope, undefined)}
          disabled={(scope === "LINE" ? selected?.discount : current) === undefined}
        >
          {copy.remove}
        </Button>
        <Button type="button" onClick={apply}>
          {copy.apply}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          {messages.common.close}
        </Button>
      </div>
    </>
  );
}
