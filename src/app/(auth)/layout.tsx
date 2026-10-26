import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <main className="grid min-h-svh place-items-center p-6">{children}</main>;
}
