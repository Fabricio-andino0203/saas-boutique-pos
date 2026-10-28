"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { FormField } from "@/components/shared/form-field";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { messages } from "@/config/messages.es";
import { saveCustomerAction } from "@/modules/customers/actions";

const copy = messages.customers.form;

type CustomerFormProps = {
  /** Con `id` se edita ese cliente; sin él, se crea uno. */
  initial?: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    taxId: string | null;
    notes: string | null;
    preferredSizes: string | null;
  };
};

/** La ficha completa del cliente. Solo el nombre es obligatorio; el servidor vuelve a revisar todo. */
export function CustomerForm({ initial }: CustomerFormProps) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [taxId, setTaxId] = useState(initial?.taxId ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [preferredSizes, setPreferredSizes] = useState(initial?.preferredSizes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    if (name.trim().length < 2) {
      setError(copy.errors.name);
      return;
    }
    startTransition(async () => {
      const result = await saveCustomerAction({
        ...(initial ? { id: initial.id } : {}),
        name,
        phone,
        email,
        taxId,
        notes,
        preferredSizes,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.push(`/clientes/${result.id}`);
      router.refresh();
    });
  }

  return (
    <form
      aria-labelledby="customer-form-title"
      className="bg-card max-w-2xl space-y-4 rounded-lg border p-5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <h2 id="customer-form-title" className="text-lg font-medium">
        {initial ? copy.editTitle : copy.createTitle}
      </h2>
      <FormField label={copy.fields.name} htmlFor="customer-form-name">
        <Input
          id="customer-form-name"
          autoFocus
          autoComplete="off"
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={copy.fields.phone} htmlFor="customer-form-phone" hint={copy.hints.phone}>
          <Input
            id="customer-form-phone"
            inputMode="tel"
            autoComplete="off"
            maxLength={20}
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
        </FormField>
        <FormField label={copy.fields.email} htmlFor="customer-form-email" hint={copy.hints.email}>
          <Input
            id="customer-form-email"
            type="email"
            autoComplete="off"
            maxLength={120}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </FormField>
        <FormField label={copy.fields.taxId} htmlFor="customer-form-tax" hint={copy.hints.taxId}>
          <Input
            id="customer-form-tax"
            autoComplete="off"
            maxLength={30}
            value={taxId}
            onChange={(event) => setTaxId(event.target.value)}
          />
        </FormField>
        <FormField
          label={copy.fields.preferredSizes}
          htmlFor="customer-form-sizes"
          hint={copy.hints.preferredSizes}
        >
          <Input
            id="customer-form-sizes"
            autoComplete="off"
            maxLength={120}
            value={preferredSizes}
            onChange={(event) => setPreferredSizes(event.target.value)}
          />
        </FormField>
      </div>
      <FormField label={copy.fields.notes} htmlFor="customer-form-notes" hint={copy.hints.notes}>
        <textarea
          id="customer-form-notes"
          rows={3}
          maxLength={500}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 w-full min-w-0 rounded-lg border bg-transparent px-2.5 py-1.5 text-base outline-none focus-visible:ring-3 md:text-sm"
        />
      </FormField>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? copy.saving : initial ? copy.save : copy.create}
        </Button>
        <Link
          href={initial ? `/clientes/${initial.id}` : "/clientes"}
          className={buttonVariants({ variant: "ghost" })}
        >
          {copy.cancel}
        </Link>
      </div>
    </form>
  );
}
