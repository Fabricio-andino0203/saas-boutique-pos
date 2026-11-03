import { redirect } from "next/navigation";

import { requirePageCapability } from "@/lib/auth";

/** La entrada de Finanzas. Por ahora lleva a los movimientos; el resumen del periodo la reemplaza en el paso 6. */
export default async function FinanceIndexPage() {
  await requirePageCapability("finance.view");
  redirect("/finanzas/movimientos");
}
