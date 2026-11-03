import type { ReactNode } from "react";

import { ThemeToggle } from "@/components/layout/theme-toggle";

export default function PlatformPublicLayout({ children }: { children: ReactNode }) {
  return (
    <main className="relative grid min-h-svh place-items-center p-6">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      {children}
    </main>
  );
}
