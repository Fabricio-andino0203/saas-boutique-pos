import { Suspense, type ReactNode } from "react";

import { ShellFallback } from "@/components/layout/shell-fallback";
import { PlatformShell } from "@/modules/platform/components/platform-shell";

export default function PlatformPanelLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<ShellFallback />}>
      <PlatformShell>{children}</PlatformShell>
    </Suspense>
  );
}
