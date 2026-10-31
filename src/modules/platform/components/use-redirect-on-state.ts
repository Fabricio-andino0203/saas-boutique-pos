"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import type { PlatformFormState } from "@/modules/platform/schemas";

/**
 * Navega cuando una acción del panel devuelve `redirectTo`. La navegación la hace el navegador (que conserva el host del
 * panel) y no el servidor: ver la nota de `modules/platform/actions.ts`.
 */
export function useRedirectOnState(state: PlatformFormState): void {
  const router = useRouter();
  const target = state?.redirectTo;
  useEffect(() => {
    if (target) {
      router.replace(target);
      router.refresh();
    }
  }, [target, router]);
}

/** Vuelve a pedir los datos de la pantalla cuando una acción termina bien (igual que el resto de formularios de la app). */
export function useRefreshOnSuccess(state: PlatformFormState): void {
  const router = useRouter();
  useEffect(() => {
    if (state?.success) {
      router.refresh();
    }
  }, [state, router]);
}
