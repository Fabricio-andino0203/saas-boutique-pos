"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { FormField } from "@/components/shared/form-field";
import { MoneyInput } from "@/components/shared/money-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { messages } from "@/config/messages.es";
import { formatMoney } from "@/lib/format";
import {
  addVariantsAction,
  quickCreateOptionAction,
  setVariantArchivedAction,
  updateVariantAction,
} from "@/modules/products/actions";
import { cellKey } from "@/modules/products/sku";
import type { ProductFormOptions, VariantRow } from "@/modules/products/types";

import { OptionPicker, type PickerItem } from "./option-picker";
import { QuantityGrid } from "./quantity-grid";

const copy = messages.products.detail;
const wizard = messages.products.wizard;

type Feedback = { error?: string; success?: string } | null;

function FeedbackText({ feedback }: { feedback: Feedback }) {
  if (feedback?.error) {
    return (
      <p role="alert" className="text-destructive text-sm">
        {feedback.error}
      </p>
    );
  }
  if (feedback?.success) {
    return (
      <p role="status" className="text-success text-sm">
        {feedback.success}
      </p>
    );
  }
  return null;
}

type VariantRowViewProps = {
  variant: VariantRow;
  canViewCost: boolean;
  canChangePrice: boolean;
  disabled: boolean;
  columns: number;
};

function VariantRowView({
  variant,
  canViewCost,
  canChangePrice,
  disabled,
  columns,
}: VariantRowViewProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [price, setPrice] = useState<number | null>(variant.priceCents);
  const [cost, setCost] = useState<number | null>(variant.costCents);
  const [reorder, setReorder] = useState(
    variant.reorderPoint === null ? "" : String(variant.reorderPoint),
  );
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [pending, startTransition] = useTransition();

  const label = [variant.sizeName, variant.colorName].filter(Boolean).join(" · ") || variant.sku;

  function save() {
    setFeedback(null);
    const reorderPoint = reorder.trim() === "" ? null : Number(reorder);
    startTransition(async () => {
      const result = await updateVariantAction(variant.id, {
        priceCents: price,
        costCents: cost,
        reorderPoint,
      });
      if (result?.success) {
        setEditing(false);
        router.refresh();
      } else {
        setFeedback(result ?? null);
      }
    });
  }

  function archive(archived: boolean) {
    setFeedback(null);
    startTransition(async () => {
      const result = await setVariantArchivedAction(variant.id, archived);
      setFeedback(result?.error ? result : null);
      if (result?.success) {
        router.refresh();
      }
    });
  }

  return (
    <>
      <TableRow data-archived={variant.archived ? "true" : undefined}>
        <TableCell className="font-mono text-xs">{variant.sku}</TableCell>
        <TableCell>{variant.sizeName ?? copy.noSize}</TableCell>
        <TableCell>
          {variant.colorName ? (
            <span className="inline-flex items-center gap-2">
              {variant.colorHex ? (
                <span
                  aria-hidden="true"
                  className="border-border size-3 rounded-full border"
                  style={{ backgroundColor: variant.colorHex }}
                />
              ) : null}
              {variant.colorName}
            </span>
          ) : (
            copy.noSize
          )}
        </TableCell>
        <TableCell className="font-mono text-xs">{variant.barcode}</TableCell>
        <TableCell className="text-right tabular-nums">
          {variant.priceCents === null ? copy.inherits : formatMoney(variant.priceCents)}
        </TableCell>
        {canViewCost ? (
          <TableCell className="text-right tabular-nums">
            {variant.costCents === null ? copy.inherits : formatMoney(variant.costCents)}
          </TableCell>
        ) : null}
        <TableCell className="text-right tabular-nums">{variant.reorderPoint ?? "—"}</TableCell>
        <TableCell className="text-right tabular-nums">{variant.onHand}</TableCell>
        <TableCell>
          {variant.archived ? messages.products.status.archived : messages.products.status.active}
        </TableCell>
        <TableCell>
          <div className="flex gap-3">
            {variant.archived || disabled ? null : (
              <button
                type="button"
                aria-label={`${copy.editVariant} ${label}`}
                className="text-primary underline underline-offset-4"
                onClick={() => setEditing((current) => !current)}
              >
                {copy.editVariant}
              </button>
            )}
            {disabled ? null : (
              <button
                type="button"
                aria-label={`${variant.archived ? copy.restoreVariant : copy.archiveVariant} ${label}`}
                className="text-muted-foreground underline underline-offset-4"
                disabled={pending}
                onClick={() => archive(!variant.archived)}
              >
                {variant.archived ? copy.restoreVariant : copy.archiveVariant}
              </button>
            )}
          </div>
        </TableCell>
      </TableRow>
      {feedback?.error && !editing ? (
        <TableRow>
          <TableCell colSpan={columns}>
            <FeedbackText feedback={feedback} />
          </TableCell>
        </TableRow>
      ) : null}
      {editing ? (
        <TableRow>
          <TableCell colSpan={columns}>
            <div className="bg-muted/50 grid gap-4 rounded-lg p-4 sm:grid-cols-4 sm:items-start">
              <FormField
                label={copy.variantColumns.price}
                htmlFor={`price-${variant.id}`}
                hint={copy.variantPriceHint}
              >
                <MoneyInput
                  id={`price-${variant.id}`}
                  valueCents={price}
                  onValueChange={setPrice}
                  disabled={!canChangePrice}
                />
              </FormField>
              {canViewCost ? (
                <FormField
                  label={copy.variantColumns.cost}
                  htmlFor={`cost-${variant.id}`}
                  hint={copy.variantCostHint}
                >
                  <MoneyInput
                    id={`cost-${variant.id}`}
                    valueCents={cost}
                    onValueChange={setCost}
                    disabled={!canChangePrice}
                  />
                </FormField>
              ) : null}
              <FormField
                label={copy.variantColumns.reorder}
                htmlFor={`reorder-${variant.id}`}
                hint={copy.reorderHint}
              >
                <Input
                  id={`reorder-${variant.id}`}
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={reorder}
                  onChange={(event) => setReorder(event.target.value)}
                />
              </FormField>
              <div className="flex gap-2 sm:pt-6">
                <Button type="button" disabled={pending} onClick={save}>
                  {copy.saveVariant}
                </Button>
                <Button type="button" variant="outline" onClick={() => setEditing(false)}>
                  {copy.cancel}
                </Button>
              </div>
            </div>
            <FeedbackText feedback={feedback} />
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

function AddVariantsPanel({
  productId,
  options,
  existing,
}: {
  productId: string;
  options: ProductFormOptions;
  existing: Set<string>;
}) {
  const router = useRouter();
  const [sizes, setSizes] = useState<PickerItem[]>(options.sizes);
  const [colors, setColors] = useState<PickerItem[]>(options.colors);
  const [sizeIds, setSizeIds] = useState<string[]>([]);
  const [colorIds, setColorIds] = useState<string[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [pending, startTransition] = useTransition();

  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((item) => item !== id) : [...list, id];

  async function addOption(entity: "sizes" | "colors", name: string): Promise<string | null> {
    const result = await quickCreateOptionAction({ entity, name });
    if ("error" in result) {
      return result.error;
    }
    const item: PickerItem = {
      id: result.option.id,
      name: result.option.name,
      hex: result.option.hex,
    };
    if (entity === "sizes") {
      setSizes((current) => [...current, item]);
      setSizeIds((current) => [...current, item.id]);
    } else {
      setColors((current) => [...current, item]);
      setColorIds((current) => [...current, item.id]);
    }
    return null;
  }

  function submit() {
    setFeedback(null);
    startTransition(async () => {
      const result = await addVariantsAction(productId, { sizeIds, colorIds, quantities });
      setFeedback(result ?? null);
      if (result?.success) {
        setSizeIds([]);
        setColorIds([]);
        setQuantities({});
        router.refresh();
      }
    });
  }

  const chosenSizes = sizes.filter((size) => sizeIds.includes(size.id));
  const chosenColors = colors.filter((color) => colorIds.includes(color.id));

  return (
    <section aria-labelledby="add-variants-title" className="space-y-4">
      <div className="space-y-1">
        <h3 id="add-variants-title" className="text-base font-medium">
          {copy.addTitle}
        </h3>
        <p className="text-muted-foreground text-sm">{copy.addHint}</p>
      </div>
      <OptionPicker
        legend={wizard.sizes}
        items={sizes}
        selected={sizeIds}
        onToggle={(id) => setSizeIds((current) => toggle(current, id))}
        onAdd={(name) => addOption("sizes", name)}
        addLabel={wizard.addSize}
        placeholder={wizard.newSizePlaceholder}
      />
      <OptionPicker
        legend={wizard.colors}
        items={colors}
        selected={colorIds}
        onToggle={(id) => setColorIds((current) => toggle(current, id))}
        onAdd={(name) => addOption("colors", name)}
        addLabel={wizard.addColor}
        placeholder={wizard.newColorPlaceholder}
      />
      {sizeIds.length + colorIds.length > 0 ? (
        <div className="overflow-x-auto">
          <QuantityGrid
            sizes={chosenSizes}
            colors={chosenColors}
            quantities={quantities}
            onChange={setQuantities}
            existing={existing}
          />
        </div>
      ) : null}
      <FeedbackText feedback={feedback} />
      <Button
        type="button"
        disabled={pending || sizeIds.length + colorIds.length === 0}
        onClick={submit}
      >
        {copy.addSubmit}
      </Button>
    </section>
  );
}

type VariantsSectionProps = {
  productId: string;
  variants: VariantRow[];
  options: ProductFormOptions;
  canViewCost: boolean;
  canChangePrice: boolean;
  productArchived: boolean;
};

export function VariantsSection({
  productId,
  variants,
  options,
  canViewCost,
  canChangePrice,
  productArchived,
}: VariantsSectionProps) {
  const columns = canViewCost ? 10 : 9;
  const existing = new Set(
    variants.filter((variant) => !variant.archived).map((v) => cellKey(v.sizeId, v.colorId)),
  );
  const heads = copy.variantColumns;

  return (
    <section aria-labelledby="variants-title" className="space-y-6">
      <h2 id="variants-title" className="text-lg font-medium">
        {copy.variantsTitle}
      </h2>
      <div className="overflow-x-auto">
        <Table>
          <TableCaption className="sr-only">{copy.variantsTitle}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{heads.sku}</TableHead>
              <TableHead>{heads.size}</TableHead>
              <TableHead>{heads.color}</TableHead>
              <TableHead>{heads.barcode}</TableHead>
              <TableHead className="text-right">{heads.price}</TableHead>
              {canViewCost ? <TableHead className="text-right">{heads.cost}</TableHead> : null}
              <TableHead className="text-right">{heads.reorder}</TableHead>
              <TableHead className="text-right">{heads.stock}</TableHead>
              <TableHead>{heads.status}</TableHead>
              <TableHead>{heads.actions}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {variants.map((variant) => (
              <VariantRowView
                key={variant.id}
                variant={variant}
                canViewCost={canViewCost}
                canChangePrice={canChangePrice}
                disabled={productArchived}
                columns={columns}
              />
            ))}
          </TableBody>
        </Table>
      </div>
      {productArchived ? null : (
        <AddVariantsPanel productId={productId} options={options} existing={existing} />
      )}
    </section>
  );
}
