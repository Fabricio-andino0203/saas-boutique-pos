import { TriangleAlert } from "lucide-react";

import { messages } from "@/config/messages.es";
import { formatLocalDate } from "@/lib/dates";
import type { TenantEntitlements } from "@/lib/tenancy/billing";

const copy = messages.subscription;

/** Cuántos días antes del vencimiento se empieza a avisar. */
const WARN_DAYS = 7;

/** Qué aviso corresponde al estado de la suscripción, o `undefined` si no hay nada que decir. */
export function subscriptionNotice(
  entitlements: TenantEntitlements | undefined,
): { text: string; tone: "warning" | "danger" } | undefined {
  if (!entitlements) {
    return undefined;
  }
  const periodEnd = formatLocalDate(new Date(entitlements.periodEnd));
  if (entitlements.mode === "readonly") {
    return {
      tone: "danger",
      text: copy.readOnly.replace(
        "{until}",
        formatLocalDate(new Date(entitlements.readOnlyEndsAt)),
      ),
    };
  }
  if (entitlements.mode === "grace") {
    return {
      tone: "warning",
      text: copy.grace
        .replace("{date}", periodEnd)
        .replace("{until}", formatLocalDate(new Date(entitlements.graceEndsAt))),
    };
  }
  if (entitlements.mode === "full" && entitlements.daysToPeriodEnd <= WARN_DAYS) {
    return {
      tone: "warning",
      text: (entitlements.status === "TRIAL" ? copy.trialEnding : copy.renewSoon).replace(
        "{date}",
        periodEnd,
      ),
    };
  }
  return undefined;
}

/** Franja arriba de la pantalla cuando la suscripción está por vencer, en gracia o en solo lectura. */
export function SubscriptionBanner({
  entitlements,
}: {
  entitlements: TenantEntitlements | undefined;
}) {
  const notice = subscriptionNotice(entitlements);
  if (!notice) {
    return null;
  }
  return (
    <div
      role={notice.tone === "danger" ? "alert" : "status"}
      data-testid="subscription-banner"
      data-mode={entitlements?.mode}
      className={
        notice.tone === "danger"
          ? "bg-destructive/10 text-destructive border-divider flex items-start gap-2 border-b px-4 py-2 text-sm"
          : "bg-warning/10 text-warning border-divider flex items-start gap-2 border-b px-4 py-2 text-sm"
      }
    >
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <p>{notice.text}</p>
    </div>
  );
}
