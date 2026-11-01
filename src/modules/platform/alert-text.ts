import { platformMessages } from "@/config/messages.platform.es";
import type { PlatformAlert } from "@/modules/platform/alerts";

const copy = platformMessages.alerts;

/** El texto de una alerta y a dónde llevar a quien la lee. Lo usan el Resumen del panel y `pnpm alerts:check`. */
export function describeAlert(alert: PlatformAlert): { text: string; href: string } {
  const who = alert.detail === "control" ? copy.control : (alert.name ?? alert.slug ?? "");
  const detail =
    alert.code === "near_limit"
      ? (copy.limitKinds[alert.detail as keyof typeof copy.limitKinds] ?? alert.detail ?? "")
      : (alert.detail ?? "");
  const text = copy.messages[alert.code].replace("{who}", who).replace("{detail}", detail);

  const href = alert.slug
    ? `/negocios/${alert.slug}`
    : alert.code.startsWith("backup") || alert.code === "retired_databases"
      ? "/respaldos"
      : "/negocios/revision";
  return { text, href };
}
