"use client";

import { useLinkStatus } from "next/link";

import { Spinner } from "@/components/ui/spinner";

/** Va dentro de un `<Link>` del menú: muestra una ruedita si la pantalla tarda en abrir (aparece tras 200 ms para no parpadear). */
export function NavPending() {
  const { pending } = useLinkStatus();
  if (!pending) {
    return null;
  }
  return (
    <Spinner className="text-muted-foreground animate-in fade-in-0 ml-auto size-3.5 [animation-delay:200ms] [animation-fill-mode:backwards]" />
  );
}
