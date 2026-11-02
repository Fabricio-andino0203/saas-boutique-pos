"use server";

import { platformMessages } from "@/config/messages.platform.es";
import { endOfLocalDay, formatLocalDate, parseLocalDateKey } from "@/lib/dates";
import { ValidationError } from "@/lib/errors";
import { parseMoney } from "@/lib/format";
import { runAsAdmin } from "@/modules/platform/action-support";
import {
  adjustSubscription,
  assignPlan,
  changePlan,
  createPlan,
  PAYMENT_METHODS,
  registerPayment,
  updatePlan,
} from "@/modules/platform/billing";
import type { PlatformFormState } from "@/modules/platform/schemas";

/**
 * Acciones del panel sobre planes, suscripciones y pagos. Todas piden de nuevo la contraseña de quien las hace y quedan en la
 * auditoría. Como el resto del panel, ninguna usa `redirect()` (ver `actions.ts`): devuelven `redirectTo`.
 */

const copy = platformMessages.billing;
const validation = copy.validation;

const text = (formData: FormData, name: string): string => String(formData.get(name) ?? "");

/** Un número entero opcional de un campo: vacío = `null`; algo que no es número se deja pasar como `NaN` para que el servicio lo rechace. */
function nullableInt(formData: FormData, name: string): number | null {
  const raw = text(formData, name).trim();
  return raw === "" ? null : Number(raw);
}

function requiredInt(formData: FormData, name: string): number {
  const raw = text(formData, name).trim();
  return raw === "" ? Number.NaN : Number(raw);
}

function localDate(
  formData: FormData,
  name: string,
  message: string,
  end = false,
): Date | undefined {
  const raw = text(formData, name).trim();
  if (raw === "") {
    return undefined;
  }
  const day = parseLocalDateKey(raw);
  if (!day) {
    throw new ValidationError(message);
  }
  return end ? endOfLocalDay(day) : day;
}

const asAdmin = runAsAdmin;

// ───────────────────────────── Planes ─────────────────────────────

/** Crea un plan (sin `id`) o guarda los cambios de uno (con `id`). */
export async function savePlanAction(
  _previous: PlatformFormState,
  formData: FormData,
): Promise<PlatformFormState> {
  const id = text(formData, "id");
  const values = {
    name: text(formData, "name"),
    description: text(formData, "description"),
    price: text(formData, "price"),
    interval: text(formData, "interval"),
    trialDays: text(formData, "trialDays"),
    backupRetentionDays: text(formData, "backupRetentionDays"),
    sortOrder: text(formData, "sortOrder"),
    limitUsers: text(formData, "limitUsers"),
    limitProducts: text(formData, "limitProducts"),
    limitTerminals: text(formData, "limitTerminals"),
    limitLocations: text(formData, "limitLocations"),
    limitPhotos: text(formData, "limitPhotos"),
    // Las casillas también se conservan: React reinicia el formulario al terminar la acción y un error no debe desmarcarlas.
    features: formData.getAll("features").map(String).join(","),
    isActive: formData.get("isActive") === "on" ? "on" : "",
  };
  return asAdmin(
    formData,
    async (context) => {
      const priceCents = parseMoney(values.price);
      if (priceCents === null) {
        throw new ValidationError(validation.price);
      }
      const input = {
        name: values.name,
        description: values.description,
        priceCents,
        interval: values.interval,
        limits: {
          users: nullableInt(formData, "limitUsers"),
          products: nullableInt(formData, "limitProducts"),
          terminals: nullableInt(formData, "limitTerminals"),
          locations: nullableInt(formData, "limitLocations"),
          photos: nullableInt(formData, "limitPhotos"),
        },
        features: formData.getAll("features").map(String),
        trialDays: requiredInt(formData, "trialDays"),
        backupRetentionDays: requiredInt(formData, "backupRetentionDays"),
        sortOrder: requiredInt(formData, "sortOrder"),
        isActive: formData.get("isActive") === "on",
      };
      if (id) {
        await updatePlan(id, input, context);
        return { success: copy.plans.form.updated };
      }
      await createPlan(input, context);
      return { redirectTo: "/planes" };
    },
    values,
  );
}

// ───────────────────────────── Suscripción de un negocio ─────────────────────────────

export async function assignPlanAction(
  _previous: PlatformFormState,
  formData: FormData,
): Promise<PlatformFormState> {
  return asAdmin(formData, async (context) => {
    await assignPlan(
      {
        slug: text(formData, "slug"),
        planId: text(formData, "planId"),
        trial: text(formData, "mode") !== "paid",
        periodEnd: localDate(formData, "until", validation.periodEnd, true),
        reason: text(formData, "reason"),
      },
      context,
    );
    return { success: copy.subscription.assign.done };
  });
}

export async function changePlanAction(
  _previous: PlatformFormState,
  formData: FormData,
): Promise<PlatformFormState> {
  const renewal = text(formData, "when") === "renewal";
  return asAdmin(formData, async (context) => {
    await changePlan(
      {
        slug: text(formData, "slug"),
        planId: text(formData, "planId"),
        when: renewal ? "renewal" : "now",
        reason: text(formData, "reason"),
      },
      context,
    );
    return {
      success: renewal ? copy.subscription.change.scheduled : copy.subscription.change.done,
    };
  });
}

export async function registerPaymentAction(
  _previous: PlatformFormState,
  formData: FormData,
): Promise<PlatformFormState> {
  return asAdmin(formData, async (context) => {
    const amountCents = parseMoney(text(formData, "amount"));
    if (amountCents === null) {
      throw new ValidationError(validation.amount);
    }
    const method = text(formData, "method");
    if (!(PAYMENT_METHODS as readonly string[]).includes(method)) {
      throw new ValidationError(validation.method);
    }
    const result = await registerPayment(
      {
        slug: text(formData, "slug"),
        amountCents,
        method: method as (typeof PAYMENT_METHODS)[number],
        reference: text(formData, "reference"),
        note: text(formData, "note"),
        paidAt: localDate(formData, "paidAt", validation.paidAtFuture),
        periods: requiredInt(formData, "periods"),
      },
      context,
    );
    const done = copy.subscription.pay.done.replace("{date}", formatLocalDate(result.coversUntil));
    return {
      success: result.deletionCancelled ? done + copy.subscription.pay.doneCancelled : done,
    };
  });
}

export async function adjustSubscriptionAction(
  _previous: PlatformFormState,
  formData: FormData,
): Promise<PlatformFormState> {
  return asAdmin(formData, async (context) => {
    const graceRaw = text(formData, "graceDays").trim();
    const readOnlyRaw = text(formData, "readOnlyDays").trim();
    await adjustSubscription(
      {
        slug: text(formData, "slug"),
        currentPeriodEnd: localDate(formData, "periodEnd", validation.periodEnd, true),
        graceDays: graceRaw === "" ? undefined : Number(graceRaw),
        readOnlyDays: readOnlyRaw === "" ? undefined : Number(readOnlyRaw),
        reason: text(formData, "reason"),
      },
      context,
    );
    return { success: copy.subscription.adjust.done };
  });
}
