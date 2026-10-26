"use client";

import { FormField } from "@/components/shared/form-field";
import { MoneyInput } from "@/components/shared/money-input";
import { NativeSelect } from "@/components/shared/native-select";
import { Input } from "@/components/ui/input";
import { messages } from "@/config/messages.es";
import type { Option, ProductFormOptions } from "@/modules/products/types";

const copy = messages.products.fields;

export type ProductDraft = {
  name: string;
  description: string;
  categoryId: string;
  brandId: string;
  seasonId: string;
  supplierId: string;
  basePriceCents: number | null;
  baseCostCents: number | null;
  taxCategory: "STANDARD" | "EXEMPT";
  code: string;
};

export const emptyDraft: ProductDraft = {
  name: "",
  description: "",
  categoryId: "",
  brandId: "",
  seasonId: "",
  supplierId: "",
  basePriceCents: null,
  baseCostCents: null,
  taxCategory: "STANDARD",
  code: "",
};

function OptionSelect({
  id,
  value,
  onChange,
  options,
  emptyLabel,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  emptyLabel: string;
}) {
  return (
    <NativeSelect id={id} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">{emptyLabel}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </NativeSelect>
  );
}

type ProductFieldsProps = {
  draft: ProductDraft;
  onChange: (draft: ProductDraft) => void;
  options: ProductFormOptions;
  canViewCost: boolean;
  /** Si no puede cambiar precios, el precio y el costo se muestran bloqueados. */
  pricesLocked?: boolean;
  /** El código solo se elige al crear. */
  showCode?: boolean;
};

export function ProductFields({
  draft,
  onChange,
  options,
  canViewCost,
  pricesLocked = false,
  showCode = false,
}: ProductFieldsProps) {
  const set = <K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) =>
    onChange({ ...draft, [key]: value });

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <FormField label={copy.name} htmlFor="product-name">
          <Input
            id="product-name"
            autoComplete="off"
            value={draft.name}
            onChange={(event) => set("name", event.target.value)}
          />
        </FormField>
      </div>

      <FormField label={copy.category} htmlFor="product-category">
        <OptionSelect
          id="product-category"
          value={draft.categoryId}
          onChange={(value) => set("categoryId", value)}
          options={options.categories}
          emptyLabel={copy.choose}
        />
      </FormField>
      <FormField label={copy.brand} htmlFor="product-brand">
        <OptionSelect
          id="product-brand"
          value={draft.brandId}
          onChange={(value) => set("brandId", value)}
          options={options.brands}
          emptyLabel={copy.noBrand}
        />
      </FormField>
      <FormField label={copy.season} htmlFor="product-season">
        <OptionSelect
          id="product-season"
          value={draft.seasonId}
          onChange={(value) => set("seasonId", value)}
          options={options.seasons}
          emptyLabel={copy.noSeason}
        />
      </FormField>
      <FormField label={copy.supplier} htmlFor="product-supplier">
        <OptionSelect
          id="product-supplier"
          value={draft.supplierId}
          onChange={(value) => set("supplierId", value)}
          options={options.suppliers}
          emptyLabel={copy.noSupplier}
        />
      </FormField>

      <FormField
        label={copy.price}
        htmlFor="product-price"
        hint={pricesLocked ? copy.priceLocked : undefined}
      >
        <MoneyInput
          id="product-price"
          valueCents={draft.basePriceCents}
          onValueChange={(cents) => set("basePriceCents", cents)}
          disabled={pricesLocked}
        />
      </FormField>
      {canViewCost ? (
        <FormField label={copy.cost} htmlFor="product-cost">
          <MoneyInput
            id="product-cost"
            valueCents={draft.baseCostCents}
            onValueChange={(cents) => set("baseCostCents", cents)}
            disabled={pricesLocked}
          />
        </FormField>
      ) : null}

      <FormField label={copy.tax} htmlFor="product-tax">
        <NativeSelect
          id="product-tax"
          value={draft.taxCategory}
          onChange={(event) =>
            set("taxCategory", event.target.value as ProductDraft["taxCategory"])
          }
        >
          <option value="STANDARD">{copy.taxStandard}</option>
          <option value="EXEMPT">{copy.taxExempt}</option>
        </NativeSelect>
      </FormField>
      {showCode ? (
        <FormField label={copy.code} htmlFor="product-code" hint={copy.codeHint}>
          <Input
            id="product-code"
            autoComplete="off"
            value={draft.code}
            onChange={(event) => set("code", event.target.value)}
          />
        </FormField>
      ) : null}

      <div className="sm:col-span-2">
        <FormField label={copy.description} htmlFor="product-description">
          <Input
            id="product-description"
            autoComplete="off"
            value={draft.description}
            onChange={(event) => set("description", event.target.value)}
          />
        </FormField>
      </div>
    </div>
  );
}
