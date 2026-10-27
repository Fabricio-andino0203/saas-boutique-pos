"use client";

import { Button } from "@/components/ui/button";

/** Abre el diálogo de impresión del navegador con la hoja que se está viendo. */
export function PrintButton({ label }: { label: string }) {
  return (
    <Button type="button" onClick={() => window.print()}>
      {label}
    </Button>
  );
}
