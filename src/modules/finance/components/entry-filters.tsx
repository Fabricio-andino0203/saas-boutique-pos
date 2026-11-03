import Link from "next/link";

import { NativeSelect } from "@/components/shared/native-select";
import { Button } from "@/components/ui/button";
import { messages } from "@/config/messages.es";
import type { CategoryRow } from "@/modules/finance/queries";
import { ALL_PAYMENT_METHODS, FINANCE_ENTRY_TYPES } from "@/modules/finance/schemas";
import type { ReportRange } from "@/modules/reports/ranges";

const copy = messages.finance.entries.filters;

type EntryFiltersProps = {
  path: string;
  range: ReportRange;
  categories: readonly CategoryRow[];
  selected: { type: string; category: string; payment: string; voided: boolean };
};

/** Tipo, categoría, forma de pago y anulados. El periodo viaja escondido para que filtrar no lo cambie. */
export function EntryFilters({ path, range, categories, selected }: EntryFiltersProps) {
  const active = selected.type || selected.category || selected.payment || selected.voided;

  return (
    <form
      method="get"
      action={path}
      aria-label={copy.title}
      className="flex flex-wrap items-end gap-3"
    >
      {range.preset ? (
        <input type="hidden" name="rango" value={range.preset} />
      ) : (
        <>
          <input type="hidden" name="desde" value={range.fromKey} />
          <input type="hidden" name="hasta" value={range.toKey} />
        </>
      )}
      <label className="space-y-1 text-sm font-medium">
        {copy.type}
        <NativeSelect name="tipo" defaultValue={selected.type} className="w-36">
          <option value="">{copy.allTypes}</option>
          {FINANCE_ENTRY_TYPES.map((type) => (
            <option key={type} value={type}>
              {messages.finance.typesPlural[type]}
            </option>
          ))}
        </NativeSelect>
      </label>
      <label className="space-y-1 text-sm font-medium">
        {copy.category}
        <NativeSelect name="categoria" defaultValue={selected.category} className="w-52">
          <option value="">{copy.allCategories}</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
              {category.archived ? ` (${messages.finance.categories.archived})` : ""}
            </option>
          ))}
        </NativeSelect>
      </label>
      <label className="space-y-1 text-sm font-medium">
        {copy.payment}
        <NativeSelect name="pago" defaultValue={selected.payment} className="w-52">
          <option value="">{copy.allPayments}</option>
          {ALL_PAYMENT_METHODS.map((method) => (
            <option key={method} value={method}>
              {messages.finance.payments[method]}
            </option>
          ))}
        </NativeSelect>
      </label>
      <label className="flex items-center gap-2 pb-1.5 text-sm">
        <input
          type="checkbox"
          name="anulados"
          value="1"
          defaultChecked={selected.voided}
          className="accent-primary size-4"
        />
        {copy.showVoided}
      </label>
      <Button type="submit" variant="outline">
        {copy.apply}
      </Button>
      {active ? (
        <Link
          href={`${path}?${range.preset ? `rango=${range.preset}` : `desde=${range.fromKey}&hasta=${range.toKey}`}`}
          className="text-primary pb-1.5 text-sm underline underline-offset-4"
        >
          {copy.clear}
        </Link>
      ) : null}
    </form>
  );
}
