import type { Metadata, Viewport } from "next";
import { Inter, Poppins } from "next/font/google";

import { themeScript } from "@/components/layout/theme-script";
import { messages } from "@/config/messages.es";

import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

// Poppins es la letra de la marca (logotipo y títulos); la interfaz sigue en Inter, como pide el kit de identidad.
const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  title: messages.app.name,
  description: "Inventario y punto de venta para boutique",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fff9fb" },
    { media: "(prefers-color-scheme: dark)", color: "#170e14" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // `suppressHydrationWarning`: el script de tema agrega la clase `dark` a <html> antes de que React hidrate.
    <html
      lang="es-HN"
      className={`${inter.variable} ${poppins.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
