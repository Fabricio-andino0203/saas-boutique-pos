"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { FormField } from "@/components/shared/form-field";
import { MoneyInput } from "@/components/shared/money-input";
import { NativeSelect } from "@/components/shared/native-select";
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
import { Notice } from "@/components/shared/notice";
import { messages } from "@/config/messages.es";
import { formatMoney } from "@/lib/format";
import { mulCents, sumCents } from "@/lib/money";
import { savePurchaseOrderAction, searchVariantsAction } from "@/modules/purchasing/actions";
import type { VariantOption } from "@/modules/purchasing/queries";

import { VariantPicker } from "./variant-picker";

const copy = messages.purchasing;

export type OrderFormLine = {
  variantId: string;
  productName: string;
  label: string;
  sku: string;
  orderedQty: number;
  unitCostCents: number;
};

type PurchaseOrderFormProps = {
  suppliers: { value: string; label: string }[];
  order?: {
    id: string;
    supplierId: string;
    expectedAt: string;
    notes: string;
    lines: OrderFormLine[];
  };
};

export function PurchaseOrderForm({ suppliers, order }: PurchaseOrderFormProps) {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState(order?.supplierId ?? "");
  const [expectedAt, setExpectedAt] = useState(order?.expectedAt ?? "");
  const [notes, setNotes] = useState(order?.notes ?? "");
  const [lines, setLines] = useState<OrderFormLine[]>(order?.lines ?? []);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const total = sumCents(lines.map((line) => mulCents(line.unitCostCents, line.orderedQty)));

  function pick(option: VariantOption) {
    setLines((current) => {
      const existing = current.find((line) => line.variantId === option.variantId);
      if (existing) {
        return current.map((line) =>
          line.variantId === option.variantId ? { ...line, orderedQty: line.orderedQty + 1 } : line,
        );
      }
      return [
        ...current,
        {
          variantId: option.variantId,
          productName: option.productName,
          label: option.label,
          sku: option.sku,
          orderedQty: 1,
          unitCostCents: option.costCents ?? 0,
        },
      ];
    });
  }

  const change = (variantId: string, patch: Partial<OrderFormLine>) =>
    setLines((current) =>
      current.map((line) => (line.variantId === variantId ? { ...line, ...patch } : line)),
    );

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await savePurchaseOrderAction(order?.id ?? null, {
        supplierId,
        expectedAt,
        notes,
        items: lines.map((line) => ({
          variantId: line.variantId,
          orderedQty: line.orderedQty,
          unitCostCents: line.unitCostCents,
        })),
      });
      if (result?.id) {
        toast.success(messages.toasts.purchaseOrderCreated);
        router.push(`/compras/${result.id}`);
        router.refresh();
      } else {
        setError(result?.error ?? messages.errors.UNEXPECTED);
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label={copy.order.supplier} htmlFor="order-supplier">
          <NativeSelect
            id="order-supplier"
            value={supplierId}
            onChange={(event) => setSupplierId(event.target.value)}
          >
            <option value="">{copy.order.chooseSupplier}</option>
            {suppliers.map((supplier) => (
              <option key={supplier.value} value={supplier.value}>
                {supplier.label}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label={copy.order.expectedAt} htmlFor="order-expected">
          <Input
            id="order-expected"
            type="date"
            value={expectedAt}
            onChange={(event) => setExpectedAt(event.target.value)}
          />
        </FormField>
        <FormField label={copy.order.notes} htmlFor="order-notes">
          <Input
            id="order-notes"
            autoComplete="off"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </FormField>
      </div>

      <section aria-labelledby="order-lines" className="space-y-3">
        <div className="space-y-1">
          <h2 id="order-lines" className="text-lg font-medium">
            {copy.order.lines}
          </h2>
          <p className="text-muted-foreground text-sm">{copy.order.linesHint}</p>
        </div>
        <VariantPicker onPick={pick} search={searchVariantsAction} />
        {lines.length > 0 ? (
          <div className="overflow-x-auto">
            <Table>
              <TableCaption className="sr-only">{copy.order.lines}</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>{copy.columns.product}</TableHead>
                  <TableHead>{copy.columns.sku}</TableHead>
                  <TableHead className="text-right">{copy.columns.quantity}</TableHead>
                  <TableHead className="text-right">{copy.columns.cost}</TableHead>
                  <TableHead className="text-right">{copy.columns.lineTotal}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line) => {
                  const name = [line.productName, line.label].filter(Boolean).join(" · ");
                  return (
                    <TableRow key={line.variantId}>
                      <TableCell>{name}</TableCell>
                      <TableCell className="font-mono text-xs">{line.sku}</TableCell>
                      <TableCell className="text-right">
                        <Input
                          aria-label={`${copy.columns.quantity}: ${name}`}
                          type="number"
                          min={1}
                          step={1}
                          inputMode="numeric"
                          className="ml-auto w-24 text-right tabular-nums"
                          value={line.orderedQty}
                          onChange={(event) =>
                            change(line.variantId, {
                              orderedQty: Math.max(0, Math.trunc(Number(event.target.value) || 0)),
                            })
                          }
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <MoneyInput
                          aria-label={`${copy.columns.cost}: ${name}`}
                          className="ml-auto w-32"
                          valueCents={line.unitCostCents}
                          onValueChange={(cents) =>
                            change(line.variantId, { unitCostCents: cents ?? 0 })
                          }
                        />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(mulCents(line.unitCostCents, line.orderedQty))}
                      </TableCell>
                      <TableCell>
                        <button
                          type="button"
                          className="text-muted-foreground underline underline-offset-4"
                          aria-label={`${copy.columns.remove}: ${name}`}
                          onClick={() =>
                            setLines((current) =>
                              current.filter((item) => item.variantId !== line.variantId),
                            )
                          }
                        >
                          {copy.columns.remove}
                        </button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : null}
        <p className="text-right font-medium">
          {copy.order.total}: <span className="tabular-nums">{formatMoney(total)}</span>
        </p>
      </section>

      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button type="button" loading={pending} onClick={save}>
        {pending ? copy.order.saving : copy.order.save}
      </Button>
    </div>
  );
}
