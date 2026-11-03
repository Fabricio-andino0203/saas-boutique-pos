"use client";

import { useFormStatus } from "react-dom";

import { Spinner } from "@/components/ui/spinner";

/**
 * Se muestra mientras el formulario que contiene el botón se está enviando. Es lo que hace que todos los botones de envío
 * tengan indicador de carga sin que cada formulario lo pida; solo detecta formularios con `action` (los que envían con
 * `onSubmit` usan la propiedad `loading` del botón).
 */
export function PendingSpinner() {
  const { pending } = useFormStatus();
  return pending ? <Spinner /> : null;
}
