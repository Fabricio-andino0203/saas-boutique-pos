"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { messages } from "@/config/messages.es";
import { updateProductAction } from "@/modules/products/actions";
import type { ProductDetail, ProductFormOptions } from "@/modules/products/types";

import { ProductFields, type ProductDraft } from "./product-fields";

const copy = messages.products.detail;

type ProductDetailFormProps = {
  product: ProductDetail;
  options: ProductFormOptions;
  canViewCost: boolean;
  canChangePrice: boolean;
};

export function ProductDetailForm({
  product,
  options,
  canViewCost,
  canChangePrice,
}: ProductDetailFormProps) {
  const router = useRouter();
  const [draft, setDraft] = useState<ProductDraft>({
    name: product.name,
    description: product.description,
    categoryId: product.categoryId,
    brandId: product.brandId,
    seasonId: product.seasonId,
    supplierId: product.supplierId,
    basePriceCents: product.basePriceCents,
    baseCostCents: product.baseCostCents,
    taxCategory: product.taxCategory,
    code: product.code,
  });
  const [feedback, setFeedback] = useState<{ error?: string; success?: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setFeedback(null);
    startTransition(async () => {
      const result = await updateProductAction(product.id, {
        ...draft,
        baseCostCents: draft.baseCostCents ?? 0,
      });
      setFeedback(result ?? null);
      if (result?.success) {
        router.refresh();
      }
    });
  }

  return (
    <section aria-labelledby="product-data-title" className="space-y-4">
      <h2 id="product-data-title" className="text-lg font-medium">
        {copy.dataTitle}
      </h2>
      <ProductFields
        draft={draft}
        onChange={setDraft}
        options={options}
        canViewCost={canViewCost}
        pricesLocked={!canChangePrice}
      />
      {feedback?.error ? (
        <p role="alert" className="text-destructive text-sm">
          {feedback.error}
        </p>
      ) : null}
      {feedback?.success ? (
        <p role="status" className="text-success text-sm">
          {feedback.success}
        </p>
      ) : null}
      <Button type="button" disabled={pending} onClick={save}>
        {pending ? copy.saving : copy.save}
      </Button>
    </section>
  );
}
