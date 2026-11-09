"use client";

import { useActionState } from "react";

import { FormField } from "@/components/shared/form-field";
import { NativeSelect } from "@/components/shared/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/shared/notice";
import { messages } from "@/config/messages.es";
import type { FormState } from "@/modules/auth/schemas";
import { setItemArchivedAction, saveItemAction } from "@/modules/catalog/actions";
import {
  CATALOG_CONFIG,
  type CatalogEntity,
  type FieldDef,
  type SelectOption,
} from "@/modules/catalog/config";

const copy = messages.catalog;

function Feedback({ state }: { state: FormState }) {
  if (state?.error) {
    return <Notice tone="error">{state.error}</Notice>;
  }
  if (state?.success) {
    return <Notice tone="success">{state.success}</Notice>;
  }
  return null;
}

function Control({
  field,
  values,
  options,
}: {
  field: FieldDef;
  values: Record<string, string> | undefined;
  options: SelectOption[];
}) {
  const value = values?.[field.name] ?? "";
  switch (field.type) {
    case "number":
      return (
        <Input
          id={field.name}
          name={field.name}
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          defaultValue={value === "" ? "0" : value}
        />
      );
    case "date":
      return <Input id={field.name} name={field.name} type="date" defaultValue={value} />;
    case "color":
      return (
        <Input
          id={field.name}
          name={field.name}
          placeholder="#1A1A1A"
          autoComplete="off"
          defaultValue={value}
        />
      );
    case "select":
      return (
        <NativeSelect id={field.name} name={field.name} defaultValue={value}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </NativeSelect>
      );
    default:
      return (
        <Input
          id={field.name}
          name={field.name}
          autoComplete="off"
          defaultValue={value}
          required={field.required}
        />
      );
  }
}

type CatalogFormProps = {
  entity: CatalogEntity;
  id: string | null;
  values?: Record<string, string>;
  options: Record<string, SelectOption[]>;
};

export function CatalogForm({ entity, id, values, options }: CatalogFormProps) {
  const [state, formAction, pending] = useActionState(
    saveItemAction.bind(null, entity, id),
    undefined,
  );

  return (
    <form action={formAction} className="space-y-4">
      {CATALOG_CONFIG[entity].fields.map((field) =>
        field.type === "checkbox" ? (
          <div key={field.name} className="space-y-1">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                name={field.name}
                defaultChecked={values ? values[field.name] === "true" : true}
                className="accent-primary size-4"
              />
              {field.label}
            </label>
            {field.hint ? <p className="text-muted-foreground text-sm">{field.hint}</p> : null}
          </div>
        ) : (
          <FormField key={field.name} label={field.label} htmlFor={field.name} hint={field.hint}>
            <Control field={field} values={values} options={options[field.name] ?? []} />
          </FormField>
        ),
      )}
      <Feedback state={state} />
      <Button type="submit" loading={pending}>
        {id
          ? pending
            ? copy.actions.saving
            : copy.actions.save
          : pending
            ? copy.actions.creating
            : copy.actions.create}
      </Button>
    </form>
  );
}

export function ArchiveForm({
  entity,
  id,
  archived,
}: {
  entity: CatalogEntity;
  id: string;
  archived: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    setItemArchivedAction.bind(null, entity, id, !archived),
    undefined,
  );
  return (
    <form action={formAction} className="space-y-2">
      {archived ? null : (
        <p className="text-muted-foreground text-sm">{copy.messages.archiveHint}</p>
      )}
      <Feedback state={state} />
      <Button type="submit" variant={archived ? "outline" : "destructive"} loading={pending}>
        {archived ? copy.actions.restore : copy.actions.archive}
      </Button>
    </form>
  );
}
