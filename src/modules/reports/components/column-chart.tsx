import { messages } from "@/config/messages.es";

type ColumnChartProps = {
  /** Qué muestra, para quien lee el gráfico con lector de pantalla (la tabla de abajo lleva los números). */
  label: string;
  items: { label: string; value: number }[];
  formatValue: (value: number) => string;
};

/**
 * Barras verticales simples, sin dependencias: la altura es proporcional al valor más alto. Siempre va acompañado de su
 * tabla (UX §7), por eso el gráfico en sí es solo una imagen con descripción.
 */
export function ColumnChart({ label, items, formatValue }: ColumnChartProps) {
  const max = Math.max(1, ...items.map((item) => item.value));
  const labelEvery = items.length <= 14 ? 1 : Math.ceil(items.length / 8);
  return (
    <figure className="space-y-1">
      <div
        role="img"
        aria-label={`${messages.reports.common.chartPrefix} ${label}`}
        className="bg-card flex h-48 items-end gap-px overflow-hidden rounded-lg border p-3"
      >
        {items.map((item) => (
          <div
            key={item.label}
            title={`${item.label}: ${formatValue(item.value)}`}
            className="flex h-full min-w-0 flex-1 flex-col justify-end"
          >
            <div
              className="bg-primary/80 rounded-t-sm"
              style={{ height: `${Math.max(item.value > 0 ? 2 : 0, (item.value / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div
        aria-hidden="true"
        className="text-muted-foreground flex gap-px px-3 text-xs tabular-nums"
      >
        {items.map((item, index) => (
          <span key={item.label} className="min-w-0 flex-1 truncate text-center">
            {index % labelEvery === 0 ? item.label : ""}
          </span>
        ))}
      </div>
      <figcaption className="sr-only">{label}</figcaption>
    </figure>
  );
}
