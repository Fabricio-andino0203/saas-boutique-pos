"use client";

import { useActionState } from "react";

import { FormField } from "@/components/shared/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/shared/notice";
import { messages } from "@/config/messages.es";
import { formatPercentBps } from "@/lib/format";
import { PAYMENT_METHODS, type SettingsSnapshot } from "@/lib/settings";
import {
  saveBusinessAction,
  saveSettingsAction,
  type SettingsGroup,
} from "@/modules/settings/actions";
import type { SettingsActionState } from "@/modules/settings/schemas";
import type { BusinessValues } from "@/modules/settings/service";

const copy = messages.settings;

function Feedback({ state }: { state: SettingsActionState }) {
  if (state?.error) {
    return <Notice tone="error">{state.error}</Notice>;
  }
  if (state?.success) {
    return <Notice tone="success">{state.success}</Notice>;
  }
  return null;
}

function Check({
  name,
  label,
  hint,
  defaultChecked,
  value,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultChecked: boolean;
  value?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          name={name}
          value={value}
          defaultChecked={defaultChecked}
          className="accent-primary size-4"
        />
        {label}
      </label>
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
}

type SaveProps = {
  /** Se llama al guardar bien (el asistente de bienvenida avanza de paso). */
  onSaved?: () => void;
  submitLabel?: string;
};

export function BusinessForm({
  values,
  onSaved,
  submitLabel = copy.save,
}: { values: BusinessValues } & SaveProps) {
  const [state, formAction, pending] = useActionState(
    async (previous: SettingsActionState, formData: FormData) => {
      const result = await saveBusinessAction(previous, formData);
      if (result?.success) {
        onSaved?.();
      }
      return result;
    },
    undefined,
  );

  return (
    <form action={formAction} className="space-y-4">
      <FormField label={copy.business.legalName} htmlFor="legalName">
        <Input id="legalName" name="legalName" autoComplete="off" defaultValue={values.legalName} />
      </FormField>
      <FormField label={copy.business.tradeName} htmlFor="tradeName">
        <Input id="tradeName" name="tradeName" autoComplete="off" defaultValue={values.tradeName} />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={copy.business.taxId} htmlFor="taxId">
          <Input id="taxId" name="taxId" autoComplete="off" defaultValue={values.taxId} />
        </FormField>
        <FormField label={copy.business.phone} htmlFor="phone">
          <Input id="phone" name="phone" autoComplete="off" defaultValue={values.phone} />
        </FormField>
      </div>
      <FormField label={copy.business.address} htmlFor="address">
        <Input id="address" name="address" autoComplete="off" defaultValue={values.address} />
      </FormField>
      {pending ? null : <Feedback state={state} />}
      <Button type="submit" loading={pending}>
        {pending ? copy.saving : submitLabel}
      </Button>
    </form>
  );
}

type SettingsFormProps = { groups: SettingsGroup[]; values: SettingsSnapshot } & SaveProps;

/** Los ajustes de los grupos pedidos; cada pantalla muestra solo los suyos. */
export function SettingsForm({
  groups,
  values,
  onSaved,
  submitLabel = copy.save,
}: SettingsFormProps) {
  const [state, formAction, pending] = useActionState(
    async (previous: SettingsActionState, formData: FormData) => {
      const result = await saveSettingsAction(groups, previous, formData);
      if (result?.success) {
        onSaved?.();
      }
      return result;
    },
    undefined,
  );

  return (
    <form action={formAction} className="space-y-6">
      {groups.includes("tax") ? (
        <fieldset className="space-y-3">
          <legend className="text-base font-medium">{copy.tax.title}</legend>
          <div className="max-w-xs">
            <FormField label={copy.tax.rate} htmlFor="taxRate" hint={copy.tax.rateHint}>
              <Input
                id="taxRate"
                name="taxRate"
                inputMode="decimal"
                autoComplete="off"
                defaultValue={formatPercentBps(values["tax.rate"])}
              />
            </FormField>
          </div>
          <Check
            name="pricesIncludeTax"
            label={copy.tax.pricesIncludeTax}
            defaultChecked={values["tax.pricesIncludeTax"]}
          />
        </fieldset>
      ) : null}

      {groups.includes("payments") ? (
        <fieldset className="space-y-3">
          <legend className="text-base font-medium">{copy.payments.title}</legend>
          <p className="text-muted-foreground text-sm">{copy.payments.description}</p>
          {PAYMENT_METHODS.map((method) => (
            <Check
              key={method}
              name="payments"
              value={method}
              label={copy.payments[method]}
              defaultChecked={values["payments.enabled"].includes(method)}
            />
          ))}
        </fieldset>
      ) : null}

      {groups.includes("rules") ? (
        <fieldset className="space-y-4">
          <legend className="text-base font-medium">{copy.rules.title}</legend>
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField
              label={copy.rules.discount}
              htmlFor="discount"
              hint={copy.rules.discountHint}
            >
              <Input
                id="discount"
                name="discount"
                type="number"
                min={0}
                max={100}
                inputMode="numeric"
                defaultValue={values["discount.maxPercent.CASHIER"]}
              />
            </FormField>
            <FormField
              label={copy.rules.returnsDays}
              htmlFor="returnsDays"
              hint={copy.rules.returnsHint}
            >
              <Input
                id="returnsDays"
                name="returnsDays"
                type="number"
                min={0}
                max={365}
                inputMode="numeric"
                defaultValue={values["returns.maxDays"]}
              />
            </FormField>
            <FormField
              label={copy.rules.layawayDays}
              htmlFor="layawayDays"
              hint={copy.rules.layawayHint}
            >
              <Input
                id="layawayDays"
                name="layawayDays"
                type="number"
                min={1}
                max={365}
                inputMode="numeric"
                defaultValue={values["layaway.expiryDays"]}
              />
            </FormField>
            <FormField
              label={copy.rules.layawayDeposit}
              htmlFor="layawayDeposit"
              hint={copy.rules.layawayDepositHint}
            >
              <Input
                id="layawayDeposit"
                name="layawayDeposit"
                type="number"
                min={0}
                max={100}
                inputMode="numeric"
                defaultValue={values["layaway.minDepositPercent"]}
              />
            </FormField>
          </div>
          <Check
            name="allowNegativeStock"
            label={copy.rules.allowNegativeStock}
            hint={copy.rules.negativeHint}
            defaultChecked={values["sales.allowNegativeStock"]}
          />
        </fieldset>
      ) : null}

      {groups.includes("codes") ? (
        <fieldset className="space-y-4">
          <legend className="text-base font-medium">{copy.codes.title}</legend>
          <div className="max-w-xs">
            <FormField
              label={copy.codes.barcodePrefix}
              htmlFor="barcodePrefix"
              hint={copy.codes.barcodeHint}
            >
              <Input
                id="barcodePrefix"
                name="barcodePrefix"
                inputMode="numeric"
                autoComplete="off"
                defaultValue={values["barcode.internalPrefix"]}
              />
            </FormField>
          </div>
          <FormField label={copy.codes.ticketFooter} htmlFor="ticketFooter">
            <Input
              id="ticketFooter"
              name="ticketFooter"
              autoComplete="off"
              defaultValue={values["ticket.footer"]}
            />
          </FormField>
        </fieldset>
      ) : null}

      {pending ? null : <Feedback state={state} />}
      <Button type="submit" loading={pending}>
        {pending ? copy.saving : submitLabel}
      </Button>
    </form>
  );
}
