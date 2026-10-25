import type { Metadata } from "next";
import { Inter } from "next/font/google";

import { messages } from "@/config/messages.es";

import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: messages.app.name,
  description: "Inventario y punto de venta para boutique",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es-HN" className={`${inter.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
