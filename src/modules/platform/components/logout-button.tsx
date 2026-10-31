"use client";

import { LogOut } from "lucide-react";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { platformLogoutAction } from "@/modules/platform/actions";
import { useRedirectOnState } from "@/modules/platform/components/use-redirect-on-state";

/** Cierra la sesión (o abandona el paso de la contraseña). `variant`: botón del encabezado o enlace de texto. */
export function LogoutButton({
  label,
  variant = "button",
}: {
  label: string;
  variant?: "button" | "link";
}) {
  const [state, formAction, pending] = useActionState(
    () => platformLogoutAction(),
    undefined as Awaited<ReturnType<typeof platformLogoutAction>>,
  );
  useRedirectOnState(state);

  return (
    <form action={formAction} className={variant === "link" ? "text-center" : undefined}>
      {variant === "link" ? (
        <button
          type="submit"
          disabled={pending}
          className="text-muted-foreground text-sm underline"
        >
          {label}
        </button>
      ) : (
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          <LogOut aria-hidden="true" />
          {label}
        </Button>
      )}
    </form>
  );
}
