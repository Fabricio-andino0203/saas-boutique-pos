import { messages } from "@/config/messages.es";
import { cn } from "@/lib/utils";
import type { FiscalAlert } from "@/modules/fiscal/alerts";

const copy = messages.fiscalAlerts;

/** El aviso de un rango según su estado, en el lenguaje de la tienda ("vence en 12 días", "quedan 30 facturas"). */
export function fiscalAlertText(
  alert: Pick<FiscalAlert, "status" | "daysLeft" | "remaining">,
): string {
  switch (alert.status) {
    case "expiring":
      return alert.daysLeft <= 0
        ? `${copy.expiresToday} ${copy.askSar}`
        : `${copy.expiresIn} ${alert.daysLeft} ${alert.daysLeft === 1 ? copy.day : copy.days}. ${copy.askSar}`;
    case "low":
      return alert.remaining === 1
        ? `${copy.leftOne} ${copy.askSar}`
        : `${copy.left} ${alert.remaining} ${copy.invoicesLeft} ${copy.askSar}`;
    case "expired":
      return `${copy.expired} ${copy.ticketsStillWork}`;
    case "exhausted":
      return `${copy.exhausted} ${copy.ticketsStillWork}`;
    default:
      return "";
  }
}

/** Los rangos de factura que necesitan atención. No dibuja nada si todo está bien. */
export function FiscalAlerts({ alerts, className }: { alerts: FiscalAlert[]; className?: string }) {
  if (alerts.length === 0) {
    return null;
  }
  return (
    <ul aria-label={copy.title} className={cn("space-y-1.5", className)}>
      {alerts.map((alert) => {
        const blocked = alert.status === "expired" || alert.status === "exhausted";
        return (
          <li
            key={alert.rangeId}
            role={blocked ? "alert" : "status"}
            className={cn(
              "rounded-lg border px-3 py-2 text-sm",
              blocked ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning",
            )}
          >
            {fiscalAlertText(alert)}{" "}
            <span className="text-xs opacity-80">
              ({alert.prefix}
              {alert.terminalName ? ` · ${alert.terminalName}` : ""})
            </span>
          </li>
        );
      })}
    </ul>
  );
}
