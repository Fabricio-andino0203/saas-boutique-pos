import type { CashTotals } from "@/modules/cash/expected";

export type CashActionState = { error?: string; success?: string } | undefined;

export type CashCloseState = { error: string } | { id: string };

export type CashPreviewState =
  { error: string } | { expectedCents: number; differenceCents: number };

/** Lo que el panel «Caja» de Vender muestra del turno abierto. Todo serializable: las fechas van en ISO. */
export type CashPanelData = {
  terminalName: string;
  openedAt: string;
  openingFloatCents: number;
  /** Lo que ofrecía el cierre anterior; null si no había uno. */
  inheritedFloatCents: number | null;
  totals: CashTotals;
  expectedCents: number;
  sales: { count: number; totalCents: number };
  movements: {
    id: string;
    type: "IN" | "OUT";
    amountCents: number;
    reason: string;
    createdAt: string;
    userName: string;
  }[];
  /** Solo si el plan incluye Finanzas: las categorías para registrar una salida como gasto. */
  financeCategories: { id: string; name: string; type: "EXPENSE" | "INCOME" }[] | null;
};

export type CashPanelState = { error: string } | { data: CashPanelData };
