"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Notice } from "@/components/shared/notice";
import { messages } from "@/config/messages.es";
import { cn } from "@/lib/utils";
import { uploadProductPhoto } from "@/modules/photos/client";
import { PendingPhotos, type PendingPhoto } from "@/modules/photos/components/pending-photos";
import { createProductAction, quickCreateOptionAction } from "@/modules/products/actions";
import type { ProductFormOptions } from "@/modules/products/types";

import { OptionPicker, type PickerItem } from "./option-picker";
import { emptyDraft, ProductFields, type ProductDraft } from "./product-fields";
import { QuantityGrid } from "./quantity-grid";

const copy = messages.products.wizard;
const validation = messages.products.validation;

function toggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
}

function firstProblem(draft: ProductDraft): string | null {
  if (draft.name.trim() === "") {
    return validation.name;
  }
  if (draft.categoryId === "") {
    return validation.category;
  }
  if (draft.basePriceCents === null || draft.basePriceCents < 1) {
    return validation.price;
  }
  return null;
}

type ProductWizardProps = { options: ProductFormOptions; canViewCost: boolean };

export function ProductWizard({ options, canViewCost }: ProductWizardProps) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<ProductDraft>(emptyDraft);
  const [sizes, setSizes] = useState<PickerItem[]>(options.sizes);
  const [colors, setColors] = useState<PickerItem[]>(options.colors);
  const [sizeIds, setSizeIds] = useState<string[]>([]);
  const [colorIds, setColorIds] = useState<string[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const chosenSizes = sizes.filter((size) => sizeIds.includes(size.id));
  const chosenColors = colors.filter((color) => colorIds.includes(color.id));
  const variantCount = Math.max(1, chosenSizes.length) * Math.max(1, chosenColors.length);

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

  function next() {
    if (step === 0) {
      const problem = firstProblem(draft);
      if (problem) {
        setError(problem);
        return;
      }
    }
    setError(null);
    setStep((current) => current + 1);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await createProductAction({
        ...draft,
        baseCostCents: draft.baseCostCents ?? 0,
        sizeIds,
        colorIds,
        quantities,
      });
      if (result?.id) {
        // El producto ya existe: ahora se suben sus fotos, una por una. Si alguna falla el producto no se pierde; la ficha lo avisa.
        let failed = 0;
        setUploadingPhotos(photos.length > 0);
        for (const item of photos) {
          const upload = await uploadProductPhoto(result.id, item.file);
          if (!upload.ok) {
            failed += 1;
          }
          URL.revokeObjectURL(item.preview);
        }
        router.push(`/productos/${result.id}?creado=1${failed > 0 ? "&fotos=error" : ""}`);
      } else {
        setError(result?.error ?? messages.errors.UNEXPECTED);
      }
    });
  }

  return (
    <div className="space-y-6">
      <ol className="flex flex-wrap gap-2 text-sm" aria-label={messages.products.wizard.title}>
        {copy.steps.map((label, index) => (
          <li
            key={label}
            aria-current={index === step ? "step" : undefined}
            className={cn(
              "rounded-full border px-3 py-1",
              index === step
                ? "border-primary bg-primary text-primary-foreground"
                : index < step
                  ? "border-primary text-primary"
                  : "text-muted-foreground",
            )}
          >
            {index + 1}. {label}
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <div className="space-y-8">
          <ProductFields
            draft={draft}
            onChange={setDraft}
            options={options}
            canViewCost={canViewCost}
            showCode
          />
          <PendingPhotos items={photos} onChange={setPhotos} disabled={pending} />
        </div>
      ) : null}

      {step === 1 ? (
        <div className="space-y-6">
          <p className="text-muted-foreground text-sm">{copy.pickHint}</p>
          <OptionPicker
            legend={copy.sizes}
            items={sizes}
            selected={sizeIds}
            onToggle={(id) => setSizeIds((current) => toggle(current, id))}
            onAdd={(name) => addOption("sizes", name)}
            addLabel={copy.addSize}
            placeholder={copy.newSizePlaceholder}
          />
          <OptionPicker
            legend={copy.colors}
            items={colors}
            selected={colorIds}
            onToggle={(id) => setColorIds((current) => toggle(current, id))}
            onAdd={(name) => addOption("colors", name)}
            addLabel={copy.addColor}
            placeholder={copy.newColorPlaceholder}
          />
        </div>
      ) : null}

      {step === 2 ? (
        <div className="space-y-6">
          <div className="space-y-1">
            <h2 className="text-lg font-medium">{copy.quantityTitle}</h2>
            <p className="text-muted-foreground text-sm">{copy.quantityHint}</p>
          </div>
          <div className="overflow-x-auto">
            <QuantityGrid
              sizes={chosenSizes}
              colors={chosenColors}
              quantities={quantities}
              onChange={setQuantities}
            />
          </div>
          <section aria-label={copy.previewTitle} className="bg-muted/50 space-y-1 rounded-lg p-4">
            <p className="font-medium">
              {copy.previewTitle}:{" "}
              {variantCount === 1 ? copy.previewOne : `${variantCount} ${copy.previewMany}`}
            </p>
            <p className="text-muted-foreground text-sm">{copy.previewNote}</p>
          </section>
        </div>
      ) : null}

      {error ? <Notice tone="error">{error}</Notice> : null}

      <div className="flex gap-2">
        {step > 0 ? (
          <Button
            type="button"
            variant="outline"
            loading={pending}
            onClick={() => {
              setError(null);
              setStep((current) => current - 1);
            }}
          >
            {copy.previous}
          </Button>
        ) : null}
        {step < copy.steps.length - 1 ? (
          <Button type="button" onClick={next}>
            {copy.next}
          </Button>
        ) : (
          <Button type="button" loading={pending} onClick={save}>
            {pending
              ? uploadingPhotos
                ? messages.photos.wizard.uploading
                : copy.saving
              : copy.save}
          </Button>
        )}
      </div>
    </div>
  );
}
