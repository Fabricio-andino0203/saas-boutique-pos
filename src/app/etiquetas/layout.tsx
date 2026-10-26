import { Suspense, type ReactNode } from "react";

/** La sesión se lee al atender la petición: la página de impresión espera dentro de un Suspense. */
export default function LabelsLayout({ children }: { children: ReactNode }) {
  return <Suspense fallback={null}>{children}</Suspense>;
}
