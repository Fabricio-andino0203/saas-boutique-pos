import { CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type NoticeTone = "error" | "success" | "warning" | "info";

const TONES: Record<
  NoticeTone,
  { icon: LucideIcon; role: "alert" | "status"; box: string; iconColor: string }
> = {
  error: {
    icon: CircleAlert,
    role: "alert",
    box: "border-destructive/30 bg-destructive/10",
    iconColor: "text-destructive",
  },
  success: {
    icon: CircleCheck,
    role: "status",
    box: "border-success/30 bg-success/10",
    iconColor: "text-success",
  },
  warning: {
    icon: TriangleAlert,
    role: "status",
    box: "border-warning/30 bg-warning/10",
    iconColor: "text-warning",
  },
  info: {
    icon: Info,
    role: "status",
    box: "border-info/30 bg-info/10",
    iconColor: "text-info",
  },
};

type NoticeProps = {
  tone: NoticeTone;
  /** Por defecto los errores se anuncian como `alert` y el resto como `status`. */
  role?: "alert" | "status";
  size?: "md" | "sm";
  className?: string;
  children: ReactNode;
};

/**
 * Aviso dentro de la pantalla (resultado de una acción, advertencia, ayuda). El icono y el fondo suave dicen el tipo sin
 * depender solo del color; el texto conserva el color normal para que se lea igual de bien en claro y en oscuro.
 */
export function Notice({ tone, role, size = "md", className, children }: NoticeProps) {
  const { icon: Icon, role: defaultRole, box, iconColor } = TONES[tone];
  const small = size === "sm";

  return (
    <div
      role={role ?? defaultRole}
      className={cn(
        "animate-in fade-in-0 slide-in-from-top-1 flex items-start gap-2 rounded-lg border duration-200",
        small ? "px-2.5 py-1.5 text-sm" : "px-3 py-2 text-sm",
        box,
        className,
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn("mt-0.5 shrink-0", small ? "size-3.5" : "size-4", iconColor)}
      />
      <div className="min-w-0 flex-1 break-words">{children}</div>
    </div>
  );
}
