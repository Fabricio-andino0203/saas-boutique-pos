import { db } from "@/lib/db";
import {
  fiscalRangeHealth,
  type FiscalRangeHealth,
  type FiscalRangeStatus,
} from "@/modules/fiscal/health";

export type FiscalAlert = FiscalRangeHealth & {
  rangeId: string;
  prefix: string;
  /** `null`: el rango sirve para todas las cajas. */
  terminalName: string | null;
};

export type InvoicingState = {
  /** Hay un rango activo y vigente: se puede emitir factura. */
  available: boolean;
  /** Los rangos activos que necesitan atención (por vencer, pocos números, vencidos o agotados). */
  alerts: FiscalAlert[];
};

const NEEDS_ATTENTION: readonly FiscalRangeStatus[] = ["expiring", "low", "expired", "exhausted"];

/**
 * Estado de la facturación con CAI: si hoy se puede facturar en la terminal y qué rangos activos hay que renovar.
 * Un negocio sin ningún rango activo no tiene alertas: vende con ticket interno.
 */
export async function getInvoicingState(
  terminalId: string,
  now: Date = new Date(),
): Promise<InvoicingState> {
  const ranges = await db.fiscalRange.findMany({
    where: {
      documentType: "INVOICE",
      isActive: true,
      OR: [{ terminalId }, { terminalId: null }],
    },
    include: { terminal: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const checked = ranges.map((range) => ({
    range,
    health: fiscalRangeHealth(range, now),
  }));
  // Se factura con el rango de la terminal si lo hay; si no, con el general.
  const own = checked.filter((entry) => entry.range.terminalId === terminalId);
  const inUse = own.length > 0 ? own : checked;
  return {
    available: inUse.some((entry) => entry.health.usable),
    alerts: checked
      .filter((entry) => NEEDS_ATTENTION.includes(entry.health.status))
      .map((entry) => ({
        ...entry.health,
        rangeId: entry.range.id,
        prefix: entry.range.prefix,
        terminalName: entry.range.terminal?.name ?? null,
      })),
  };
}
