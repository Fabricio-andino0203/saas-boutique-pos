"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

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
import { receiveGoodsAction, searchVariantsAction } from "@/modules/purchasing/actions";
import type { VariantOption } from "@/modules/purchasing/queries";

import { VariantPicker } from "./variant-picker";

const copy = messages.purchasing;

export type ReceiptFormLine = {
  variantId: string;
  productName: string;
  label: string;
  sku: string;
  quantity: number;
  /** Con orden: lo que todavía falta por llegar. */
  pending: number | null;
  unitCostCents: number;
};

type ReceiptFormProps = {
  suppliers: { value: string; label: string }[];
  canCaptureCost: boolean;
  order?: { id: string; number: string; supplierName: string; lines: ReceiptFormLine[] };
};

export function ReceiptForm({ suppliers, canCaptureCost, order }: ReceiptFormProps) {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState("");
  const [invoice, setInvoice] = useState("");
  const [lines, setLines] = useState<ReceiptFormLine[]>(order?.lines ?? []);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const total = sumCents(lines.map((line) => mulCents(line.unitCostCents, line.quantity)));
  const units = lines.reduce((sum, line) => sum + line.quantity, 0);

  function pick(option: VariantOption) {
    setNotice(null);
    const known = lines.find((line) => line.variantId === option.variantId);
    if (order && !known) {
      setNotice(copy.receipt.notInOrder);
      return;
    }
    setLines((current) => {
      if (known) {
        return current.map((line) =>
          line.variantId === option.variantId
            ? {
                ...line,
                quantity: Math.min(line.quantity + 1, line.pending ?? Number.MAX_SAFE_INTEGER),
              }
            : line,
        );
      }
      return [
        ...current,
        {
          variantId: option.variantId,
          productName: option.productName,
          label: option.label,
          sku: option.sku,
          quantity: 1,
          pending: null,
          unitCostCents: option.costCents ?? 0,
        },
      ];
    });
  }

  const change = (variantId: string, patch: Partial<ReceiptFormLine>) =>
    setLines((current) =>
      current.map((line) => (line.variantId === variantId ? { ...line, ...patch } : line)),
    );

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await receiveGoodsAction({
        purchaseOrderId: order?.id,
        supplierId: order ? undefined : supplierId,
        supplierInvoiceRef: invoice,
        items: lines
          .filter((line) => line.quantity > 0)
          .map((line) => ({
            variantId: line.variantId,
            quantity: line.quantity,
            ...(canCaptureCost ? { unitCostCents: line.unitCostCents } : {}),
          })),
      });
      if (result?.id) {
        router.push(`/compras/recepciones/${result.id}?recibida=1`);
        router.refresh();
      } else {
        setError(result?.error ?? messages.errors.UNEXPECTED);
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        {order ? (
          <p className="text-sm">
            {copy.receipt.fromOrder}{" "}
            <span className="font-medium">
              {order.number} · {order.supplierName}
            </span>
          </p>
        ) : (
          <FormField label={copy.receipt.supplier} htmlFor="receipt-supplier">
            <NativeSelect
              id="receipt-supplier"
              value={supplierId}
              onChange={(event) => setSupplierId(event.target.value)}
            >
              <option value="">{copy.receipt.chooseSupplier}</option>
              {suppliers.map((supplier) => (
                <option key={supplier.value} value={supplier.value}>
                  {supplier.label}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        )}
        <FormField label={copy.receipt.invoice} htmlFor="receipt-invoice">
          <Input
            id="receipt-invoice"
            autoComplete="off"
            value={invoice}
            onChange={(event) => setInvoice(event.target.value)}
          />
        </FormField>
      </div>

      <section aria-labelledby="receipt-lines" className="space-y-3">
        <div className="space-y-1">
          <h2 id="receipt-lines" className="text-lg font-medium">
            {copy.receipt.lines}
          </h2>
          <p className="text-muted-foreground text-sm">{copy.receipt.linesHint}</p>
        </div>
        <VariantPicker onPick={pick} helper={notice} search={searchVariantsAction} />

        {lines.length === 0 ? (
          <p className="text-muted-foreground text-sm">{copy.receipt.empty}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableCaption className="sr-only">{copy.receipt.lines}</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>{copy.columns.product}</TableHead>
                  <TableHead>{copy.columns.sku}</TableHead>
                  {order ? (
                    <TableHead className="text-right">{copy.columns.pending}</TableHead>
                  ) : null}
                  <TableHead className="text-right">{copy.columns.quantity}</TableHead>
                  {canCaptureCost ? (
                    <TableHead className="text-right">{copy.columns.cost}</TableHead>
                  ) : null}
                  {canCaptureCost ? (
                    <TableHead className="text-right">{copy.columns.lineTotal}</TableHead>
                  ) : null}
                  {order ? null : <TableHead />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line) => {
                  const name = [line.productName, line.label].filter(Boolean).join(" · ");
                  return (
                    <TableRow key={line.variantId}>
                      <TableCell>{name}</TableCell>
                      <TableCell className="font-mono text-xs">{line.sku}</TableCell>
                      {order ? (
                        <TableCell className="text-right tabular-nums">{line.pending}</TableCell>
                      ) : null}
                      <TableCell className="text-right">
                        <Input
                          aria-label={`${copy.columns.quantity}: ${name}`}
                          type="number"
                          min={0}
                          max={line.pending ?? undefined}
                          step={1}
                          inputMode="numeric"
                          className="ml-auto w-24 text-right tabular-nums"
                          value={line.quantity}
                          onChange={(event) =>
                            change(line.variantId, {
                              quantity: Math.max(0, Math.trunc(Number(event.target.value) || 0)),
                            })
                          }
                        />
                      </TableCell>
                      {canCaptureCost ? (
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
                      ) : null}
                      {canCaptureCost ? (
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(mulCents(line.unitCostCents, line.quantity))}
                        </TableCell>
                      ) : null}
                      {order ? null : (
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
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="text-right font-medium">
          <span className="tabular-nums">{units}</span> {copy.receipt.units}
          {canCaptureCost ? (
            <>
              {" · "}
              {copy.receipt.total}: <span className="tabular-nums">{formatMoney(total)}</span>
            </>
          ) : null}
        </p>
        {canCaptureCost ? null : (
          <p className="text-muted-foreground text-sm">{copy.receipt.costIgnored}</p>
        )}
      </section>

      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button type="button" disabled={pending || units === 0} onClick={confirm}>
        {pending ? copy.receipt.confirming : copy.receipt.confirm}
      </Button>
    </div>
  );
}
