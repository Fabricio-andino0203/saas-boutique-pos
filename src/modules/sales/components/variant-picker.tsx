"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { messages } from "@/config/messages.es";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SellableProduct, SellableVariant } from "@/modules/sales/pos-types";

const copy = messages.pos.picker;

type VariantPickerProps = {
  product: SellableProduct | null;
  allowNegativeStock: boolean;
  onPick: (variant: SellableVariant) => void;
  onClose: () => void;
};

/** Elegir talla y color: una ficha por variante, con lo que queda; las agotadas se ven atenuadas pero a la vista. */
export function VariantPicker({
  product,
  allowNegativeStock,
  onPick,
  onClose,
}: VariantPickerProps) {
  return (
    <Dialog open={product !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{product?.name ?? copy.title}</DialogTitle>
          <DialogDescription>
            {copy.title}. {copy.hint}
          </DialogDescription>
        </DialogHeader>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {product?.variants.map((variant) => {
            const out = variant.onHand <= 0;
            const label =
              [variant.sizeName, variant.colorName].filter(Boolean).join(" · ") || variant.sku;
            return (
              <li key={variant.variantId}>
                <button
                  type="button"
                  disabled={out && !allowNegativeStock}
                  onClick={() => onPick(variant)}
                  className={cn(
                    "hover:border-primary focus-visible:ring-ring/50 flex min-h-16 w-full flex-col items-start gap-0.5 rounded-lg border p-2.5 text-left outline-none focus-visible:ring-3",
                    out && "opacity-50",
                  )}
                >
                  <span className="flex items-center gap-1.5 font-medium">
                    {variant.colorHex ? (
                      <span
                        aria-hidden="true"
                        className="size-3 rounded-full border"
                        style={{ backgroundColor: variant.colorHex }}
                      />
                    ) : null}
                    {label}
                  </span>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {formatMoney(variant.priceCents)} ·{" "}
                    {out ? copy.out : `${variant.onHand} ${copy.left}`}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
