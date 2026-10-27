"use client";

import { useEffect } from "react";

/** Abre el diálogo de impresión del navegador una vez que la hoja ya se dibujó (ticket recién cobrado o reimpresión). */
export function AutoPrint() {
  useEffect(() => {
    const timer = setTimeout(() => window.print(), 400);
    return () => clearTimeout(timer);
  }, []);
  return null;
}
