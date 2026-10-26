import { Suspense, type ReactNode } from "react";

import { AuthenticatedShell } from "@/components/layout/authenticated-shell";
import { ShellFallback } from "@/components/layout/shell-fallback";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<ShellFallback />}>
      <AuthenticatedShell>{children}</AuthenticatedShell>
    </Suspense>
  );
}
