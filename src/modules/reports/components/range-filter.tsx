import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { messages } from "@/config/messages.es";
import { cn } from "@/lib/utils";
import { RANGE_PRESETS, type ReportRange } from "@/modules/reports/ranges";

const copy = messages.reports.filter;

type RangeFilterProps = {
  /** La ruta del reporte (`/reportes/ventas`). */
  path: string;
  range: ReportRange;
  /** Lo demás que hay que conservar al cambiar el periodo (por ejemplo `por=categoria`). */
  params?: Record<string, string>;
};

/** El periodo del reporte: atajos (Hoy, Ayer, Esta semana, Este mes…) y fechas exactas. Todo por la dirección. */
export function RangeFilter({ path, range, params = {} }: RangeFilterProps) {
  const hrefFor = (preset: string) =>
    `${path}?${new URLSearchParams({ ...params, rango: preset }).toString()}`;
  return (
    <section aria-label={copy.title} className="space-y-3">
      <nav aria-label={copy.title} className="flex flex-wrap gap-2">
        {RANGE_PRESETS.map((preset) => (
          <Link
            key={preset}
            href={hrefFor(preset)}
            aria-current={range.preset === preset ? "true" : undefined}
            className={cn(
              "focus-visible:ring-ring/50 min-h-9 rounded-full border px-3.5 py-1.5 text-sm outline-none focus-visible:ring-3",
              range.preset === preset
                ? "border-primary bg-primary text-primary-foreground"
                : "hover:bg-muted",
            )}
          >
            {copy.presets[preset]}
          </Link>
        ))}
      </nav>
      <form method="get" action={path} className="flex flex-wrap items-end gap-3">
        {Object.entries(params).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <label className="space-y-1 text-sm font-medium">
          {copy.from}
          <Input type="date" name="desde" defaultValue={range.fromKey} className="w-44" />
        </label>
        <label className="space-y-1 text-sm font-medium">
          {copy.to}
          <Input type="date" name="hasta" defaultValue={range.toKey} className="w-44" />
        </label>
        <Button type="submit" variant="outline">
          {copy.apply}
        </Button>
      </form>
    </section>
  );
}
