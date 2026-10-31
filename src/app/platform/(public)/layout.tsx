import type { ReactNode } from "react";

export default function PlatformPublicLayout({ children }: { children: ReactNode }) {
  return <main className="grid min-h-svh place-items-center p-6">{children}</main>;
}
