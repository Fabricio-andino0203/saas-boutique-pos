import type { FinanceEntryType } from "@/generated/prisma/client";

/**
 * Categorías con las que nace el módulo de Finanzas (la migración `finance` las siembra en los negocios que ya existen y
 * `seedBase` en los nuevos). Después cada negocio agrega, renombra o archiva las suyas.
 */
export const DEFAULT_FINANCE_CATEGORIES: readonly { type: FinanceEntryType; name: string }[] = [
  { type: "EXPENSE", name: "Alquiler" },
  { type: "EXPENSE", name: "Servicios (agua, luz, internet)" },
  { type: "EXPENSE", name: "Sueldos y comisiones" },
  { type: "EXPENSE", name: "Publicidad" },
  { type: "EXPENSE", name: "Transporte y envíos" },
  { type: "EXPENSE", name: "Empaques" },
  { type: "EXPENSE", name: "Mantenimiento" },
  { type: "EXPENSE", name: "Impuestos y permisos" },
  { type: "EXPENSE", name: "Otros gastos" },
  { type: "INCOME", name: "Aporte del dueño" },
  { type: "INCOME", name: "Otros ingresos" },
];
