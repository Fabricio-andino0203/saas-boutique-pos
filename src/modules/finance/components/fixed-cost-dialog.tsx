"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { FormField } from "@/components/shared/form-field";
import { MoneyInput } from "@/components/shared/money-input";
import { NativeSelect } from "@/components/shared/native-select";
import { Notice } from "@/components/shared/notice";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { messages } from "@/config/messages.es";
import { createFixedCostAction, updateFixedCostAction } from "@/modules/finance/actions";
import { periodOf } from "@/modules/finance/periods";

const copy = messages.finance.fixed;
const form = copy.form;

type Option = { id: string; name: string };

type Editing = {
  id: string;
  name: string;
  categoryId: string;
  amountCents: number;
  dueDay: number;
  startsOn: string;
  endsOn: string | null;
};

type FixedCostDialogProps = {
  categories: readonly Option[];
  /** Si viene, se edita ese costo; si no, se crea uno nuevo. */
  editing?: Editing;
};

/** «Nuevo costo fijo» o «Editar»: abre el formulario en una ventana. */
export function FixedCostDialog({ categories, editing }: FixedCostDialogProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant={editing ? "ghost" : "default"}
        size={editing ? "sm" : "default"}
        aria-label={editing ? `${copy.edit}: ${editing.name}` : undefined}
        onClick={() => setOpen(true)}
      >
        {editing ? copy.edit : copy.new}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          {open ? (
            <FixedCostForm
              categories={categories}
              editing={editing}
              onClose={() => setOpen(false)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function FixedCostForm({
  categories,
  editing,
  onClose,
}: FixedCostDialogProps & { onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(editing?.name ?? "");
  const [categoryId, setCategoryId] = useState(editing?.categoryId ?? categories[0]?.id ?? "");
  const [amountCents, setAmountCents] = useState<number | null>(editing?.amountCents ?? null);
  const [dueDay, setDueDay] = useState(String(editing?.dueDay ?? 5));
  const [startsOn, setStartsOn] = useState(editing?.startsOn ?? periodOf(new Date()));
  const [endsOn, setEndsOn] = useState(editing?.endsOn ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const input = {
        name,
        categoryId,
        amountCents: amountCents ?? 0,
        dueDay: Number(dueDay),
        startsOn,
        endsOn,
      };
      const result = editing
        ? await updateFixedCostAction(editing.id, input)
        : await createFixedCostAction(input);
      if (result.ok) {
        onClose();
        toast.success(
          editing ? messages.toasts.fixedCostUpdated : messages.toasts.fixedCostCreated,
        );
        router.refresh();
      } else {
        setError(result.error.message);
      }
    });
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <DialogHeader>
        <DialogTitle>{editing ? form.titleEdit : form.titleNew}</DialogTitle>
        <DialogDescription>{form.description}</DialogDescription>
      </DialogHeader>

      <FormField label={form.name} htmlFor="fixed-name" hint={form.nameHint}>
        <Input
          id="fixed-name"
          autoFocus
          autoComplete="off"
          maxLength={80}
          value={name}
          required
          onChange={(event) => setName(event.target.value)}
        />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={form.category} htmlFor="fixed-category">
          <NativeSelect
            id="fixed-category"
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
            required
          >
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label={form.amount} htmlFor="fixed-amount">
          <MoneyInput id="fixed-amount" valueCents={amountCents} onValueChange={setAmountCents} />
        </FormField>
        <FormField label={form.dueDay} htmlFor="fixed-day">
          <Input
            id="fixed-day"
            type="number"
            inputMode="numeric"
            min={1}
            max={28}
            value={dueDay}
            required
            onChange={(event) => setDueDay(event.target.value)}
          />
        </FormField>
        <FormField label={form.startsOn} htmlFor="fixed-starts">
          <Input
            id="fixed-starts"
            type="month"
            value={startsOn}
            required
            onChange={(event) => setStartsOn(event.target.value)}
          />
        </FormField>
        <FormField label={form.endsOn} htmlFor="fixed-ends">
          <Input
            id="fixed-ends"
            type="month"
            value={endsOn}
            min={startsOn}
            onChange={(event) => setEndsOn(event.target.value)}
          />
        </FormField>
      </div>

      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          {messages.common.cancel}
        </Button>
        <Button type="submit" loading={pending}>
          {pending ? form.submitting : form.submit}
        </Button>
      </div>
    </form>
  );
}
