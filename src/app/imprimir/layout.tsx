import { Suspense, type ReactNode } from "react";

/** Hojas para imprimir (cierres, tickets, facturas): sin menú. La sesión se lee al atender la petición. */
export default function PrintLayout({ children }: { children: ReactNode }) {
  return <Suspense fallback={null}>{children}</Suspense>;
}
