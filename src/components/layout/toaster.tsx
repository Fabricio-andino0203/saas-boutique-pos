"use client";

import type { CSSProperties } from "react";
import { Toaster as Sonner } from "sonner";

import { useIsDark } from "@/components/layout/use-theme";

/** Cada tipo mezcla su color semántico con la superficie del tema: se ve en claro y en oscuro sin colores fijos. */
const tint = (token: string) => ({
  bg: `color-mix(in oklab, var(--${token}) 12%, var(--popover))`,
  border: `color-mix(in oklab, var(--${token}) 40%, transparent)`,
});

const style = {
  "--normal-bg": "var(--popover)",
  "--normal-text": "var(--popover-foreground)",
  "--normal-border": "var(--divider)",
  "--success-bg": tint("success").bg,
  "--success-border": tint("success").border,
  "--success-text": "var(--popover-foreground)",
  "--error-bg": tint("destructive").bg,
  "--error-border": tint("destructive").border,
  "--error-text": "var(--popover-foreground)",
  "--warning-bg": tint("warning").bg,
  "--warning-border": tint("warning").border,
  "--warning-text": "var(--popover-foreground)",
  "--info-bg": tint("info").bg,
  "--info-border": tint("info").border,
  "--info-text": "var(--popover-foreground)",
  "--border-radius": "var(--radius-xl)",
} as CSSProperties;

/** Confirmaciones breves (`toast.success(...)`): aparecen arriba al centro, se van solas y respetan «reducir movimiento». */
export function Toaster() {
  const dark = useIsDark();

  return (
    <Sonner
      theme={dark ? "dark" : "light"}
      position="top-center"
      richColors
      duration={3500}
      style={style}
      toastOptions={{ classNames: { toast: "font-sans text-sm" } }}
    />
  );
}
