import { messages } from "@/config/messages.es";
import type { PlanLimitKind } from "@/config/plan-catalog";
import { currentEntitlements } from "@/lib/entitlements";
import { limitOf } from "@/lib/tenancy/billing";

const copy = messages.subscription;

/**
 * Cuánto lleva el negocio de lo que su plan limita («3 de 5 usuarios»). No muestra nada si el plan no tiene tope. Es solo una
 * pista: el tope lo exige el servidor al crear (`assertWithinPlanLimit`).
 */
export async function PlanUsageHint({
  kind,
  used,
}: {
  kind: Extract<PlanLimitKind, "users" | "products">;
  used: number;
}) {
  const limit = limitOf(await currentEntitlements(), kind);
  if (limit === null) {
    return null;
  }
  const over = used >= limit;
  const text = (over ? copy.usageOver : copy.usage)
    .replace("{used}", String(used))
    .replace("{limit}", String(limit))
    .replace("{what}", copy.limitKinds[kind]);
  return (
    <p
      role="status"
      data-testid={`plan-usage-${kind}`}
      className={over ? "text-warning text-sm" : "text-muted-foreground text-sm"}
    >
      {text}
    </p>
  );
}
