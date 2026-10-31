import type { Metadata } from "next";
import type { ReactNode } from "react";

import { platformMessages } from "@/config/messages.platform.es";

// El panel no debe aparecer en buscadores ni guardarse en cachés compartidas.
export const metadata: Metadata = {
  title: { default: platformMessages.app.name, template: `%s · ${platformMessages.app.short}` },
  robots: { index: false, follow: false },
};

export default function PlatformLayout({ children }: { children: ReactNode }) {
  return children;
}
