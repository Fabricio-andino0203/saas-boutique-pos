"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";

import { EmptyState } from "@/components/shared/empty-state";
import { FormField } from "@/components/shared/form-field";
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
import { messages } from "@/config/messages.es";
import { saveFiscalRangeAction, setFiscalRangeActiveAction } from "@/modules/settings/actions";
import type { FiscalRangeRow } from "@/modules/settings/service";

const copy = messages.settings.fiscal;

function Row({ range }: { range: FiscalRangeRow }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const status = range.isActive
    ? range.expired
      ? copy.status.expired
      : copy.status.active
    : copy.status.inactive;

  return (
    <TableRow>
      <TableCell>{copy.types[range.documentType]}</TableCell>
      <TableCell>{range.terminalName}</TableCell>
      <TableCell className="font-mono text-xs">{range.cai}</TableCell>
      <TableCell className="tabular-nums">
        {range.prefix}
        {range.rangeStart} – {range.rangeEnd}
      </TableCell>
      <TableCell className="tabular-nums">{range.nextNumber}</TableCell>
      <TableCell>{range.expiresAt}</TableCell>
      <TableCell>{status}</TableCell>
      <TableCell>
        <div className="space-y-1">
          <button
            type="button"
            className="text-primary underline underline-offset-4"
            disabled={pending}
            aria-label={`${range.isActive ? copy.deactivate : copy.activate} ${range.cai}`}
            onClick={() =>
              startTransition(async () => {
                const result = await setFiscalRangeActiveAction(range.id, !range.isActive);
                setError(result?.error ?? null);
                if (result?.success) {
                  router.refresh();
                }
              })
            }
          >
            {range.isActive ? copy.deactivate : copy.activate}
          </button>
          {error ? (
            <p role="alert" className="text-destructive max-w-56 text-xs">
              {error}
            </p>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
}

export function FiscalRangeTable({ ranges }: { ranges: FiscalRangeRow[] }) {
  if (ranges.length === 0) {
    return <EmptyState title={copy.empty.title} description={copy.empty.description} />;
  }
  const heads = copy.columns;
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableCaption className="sr-only">{copy.title}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>{heads.type}</TableHead>
            <TableHead>{heads.terminal}</TableHead>
            <TableHead>{heads.cai}</TableHead>
            <TableHead>{heads.range}</TableHead>
            <TableHead>{heads.next}</TableHead>
            <TableHead>{heads.expires}</TableHead>
            <TableHead>{heads.status}</TableHead>
            <TableHead>{heads.actions}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ranges.map((range) => (
            <Row key={range.id} range={range} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function FiscalRangeForm({ terminals }: { terminals: { value: string; label: string }[] }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    async (previous: Awaited<ReturnType<typeof saveFiscalRangeAction>>, formData: FormData) => {
      const result = await saveFiscalRangeAction(previous, formData);
      if (result?.success) {
        router.refresh();
      }
      return result;
    },
    undefined,
  );
  const fields = copy.fields;

  return (
    <form action={formAction} className="space-y-4">
      <h2 className="text-lg font-medium">{copy.new}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={fields.type} htmlFor="documentType">
          <NativeSelect id="documentType" name="documentType" defaultValue="INVOICE">
            <option value="INVOICE">{copy.types.INVOICE}</option>
            <option value="CREDIT_NOTE">{copy.types.CREDIT_NOTE}</option>
          </NativeSelect>
        </FormField>
        <FormField label={fields.terminal} htmlFor="terminalId">
          <NativeSelect id="terminalId" name="terminalId" defaultValue={terminals[0]?.value ?? ""}>
            {terminals.map((terminal) => (
              <option key={terminal.value} value={terminal.value}>
                {terminal.label}
              </option>
            ))}
          </NativeSelect>
        </FormField>
      </div>
      <FormField label={fields.cai} htmlFor="cai" hint={fields.caiHint}>
        <Input id="cai" name="cai" autoComplete="off" className="font-mono" />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-4">
        <FormField label={fields.prefix} htmlFor="prefix" hint={fields.prefixHint}>
          <Input id="prefix" name="prefix" autoComplete="off" />
        </FormField>
        <FormField label={fields.start} htmlFor="rangeStart">
          <Input id="rangeStart" name="rangeStart" type="number" min={1} inputMode="numeric" />
        </FormField>
        <FormField label={fields.end} htmlFor="rangeEnd">
          <Input id="rangeEnd" name="rangeEnd" type="number" min={1} inputMode="numeric" />
        </FormField>
        <FormField label={fields.expires} htmlFor="expiresAt">
          <Input id="expiresAt" name="expiresAt" type="date" />
        </FormField>
      </div>
      {state?.error ? (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      ) : null}
      {state?.success ? (
        <p role="status" className="text-success text-sm">
          {state.success}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? copy.creating : copy.create}
      </Button>
    </form>
  );
}
