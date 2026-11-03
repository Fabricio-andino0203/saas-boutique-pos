"use client";

import { useState, useTransition } from "react";

import { FormField } from "@/components/shared/form-field";
import { NativeSelect } from "@/components/shared/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/shared/notice";
import { messages } from "@/config/messages.es";
import type { LabelTemplate } from "@/lib/settings";
import { saveLabelTemplateAction, type LabelActionState } from "@/modules/labels/actions";

const copy = messages.labels.templateForm;

const toNumber = (text: string): number => (text.trim() === "" ? Number.NaN : Number(text));

/** Un boceto de la etiqueta, a escala, con el texto de ejemplo que llevará. */
function Preview({ template }: { template: LabelTemplate }) {
  const scale = 4; // píxeles por milímetro
  const width = Math.max(40, Math.min(template.widthMm, 150)) * scale;
  const height = Math.max(30, Math.min(template.heightMm, 100)) * scale;
  return (
    <div
      aria-label={copy.preview}
      role="img"
      className="bg-background flex flex-col justify-between rounded border border-dashed p-2 text-black"
      style={{ width, height, maxWidth: "100%" }}
    >
      {template.showName ? <div className="text-xs font-bold">Vestido floral</div> : null}
      {template.showVariant || template.showSku || template.showPrice ? (
        <div className="flex justify-between gap-2 text-[10px]">
          <span>
            {template.showVariant ? "M · Rojo" : ""}
            {template.showVariant && template.showSku ? " · " : ""}
            {template.showSku ? "P00077-M-ROJO" : ""}
          </span>
          {template.showPrice ? <span className="font-bold">L 850.00</span> : null}
        </div>
      ) : null}
      <div
        className="flex-1 self-stretch"
        style={{
          margin: "4px 0 0",
          backgroundImage:
            "repeating-linear-gradient(90deg, #000 0 2px, transparent 2px 4px, #000 4px 5px, transparent 5px 8px)",
          opacity: 0.85,
          minHeight: 16,
        }}
      />
    </div>
  );
}

export function LabelTemplateForm({ initial }: { initial: LabelTemplate }) {
  const [template, setTemplate] = useState<LabelTemplate>(initial);
  const [fields, setFields] = useState({
    widthMm: String(initial.widthMm),
    heightMm: String(initial.heightMm),
    columns: String(initial.columns),
    gapMm: String(initial.gapMm),
  });
  const [state, setState] = useState<LabelActionState>(undefined);
  const [pending, startTransition] = useTransition();

  const current: LabelTemplate = {
    ...template,
    widthMm: toNumber(fields.widthMm),
    heightMm: toNumber(fields.heightMm),
    columns: toNumber(fields.columns),
    gapMm: toNumber(fields.gapMm),
  };

  function save() {
    setState(undefined);
    startTransition(async () => {
      setState(await saveLabelTemplateAction(current));
    });
  }

  const check = (key: "showName" | "showVariant" | "showSku" | "showPrice") => (
    <label key={key} className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        className="accent-primary size-4"
        checked={template[key]}
        onChange={(event) => setTemplate({ ...template, [key]: event.target.checked })}
      />
      {copy[key]}
    </label>
  );

  return (
    <div className="space-y-6">
      <fieldset className="flex flex-wrap gap-x-6 gap-y-2">
        <legend className="mb-1 text-sm font-medium">{copy.layout}</legend>
        {(
          [
            ["roll", copy.roll],
            ["sheet", copy.sheet],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="label-layout"
              className="accent-primary size-4"
              checked={template.layout === value}
              onChange={() => setTemplate({ ...template, layout: value })}
            />
            {label}
          </label>
        ))}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-4">
        <FormField label={copy.width} htmlFor="label-width">
          <Input
            id="label-width"
            type="number"
            inputMode="numeric"
            value={fields.widthMm}
            onChange={(event) => setFields({ ...fields, widthMm: event.target.value })}
          />
        </FormField>
        <FormField label={copy.height} htmlFor="label-height">
          <Input
            id="label-height"
            type="number"
            inputMode="numeric"
            value={fields.heightMm}
            onChange={(event) => setFields({ ...fields, heightMm: event.target.value })}
          />
        </FormField>
        {template.layout === "sheet" ? (
          <>
            <FormField label={copy.columns} htmlFor="label-columns">
              <NativeSelect
                id="label-columns"
                value={fields.columns}
                onChange={(event) => setFields({ ...fields, columns: event.target.value })}
              >
                {[1, 2, 3, 4, 5, 6].map((count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label={copy.gap} htmlFor="label-gap">
              <Input
                id="label-gap"
                type="number"
                inputMode="numeric"
                value={fields.gapMm}
                onChange={(event) => setFields({ ...fields, gapMm: event.target.value })}
              />
            </FormField>
          </>
        ) : null}
      </div>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">{copy.fields}</legend>
        {(["showName", "showVariant", "showSku", "showPrice"] as const).map(check)}
        <p className="text-muted-foreground text-xs">{copy.barcode}</p>
      </fieldset>

      <div className="space-y-2">
        <p className="text-sm font-medium">{copy.preview}</p>
        <Preview template={current} />
      </div>

      {state?.error ? <Notice tone="error">{state.error}</Notice> : null}
      {state?.success ? <Notice tone="success">{state.success}</Notice> : null}
      <Button type="button" loading={pending} onClick={save}>
        {pending ? copy.saving : copy.save}
      </Button>
    </div>
  );
}
