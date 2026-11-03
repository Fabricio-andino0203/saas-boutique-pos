import { cn } from "@/lib/utils";

type StatCardProps = {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "good" | "bad";
};

/** Una cifra grande con su nombre: las tarjetas del resumen y del dashboard. */
export function StatCard({ label, value, hint, tone = "default" }: StatCardProps) {
  return (
    <div role="group" aria-label={label} className="bg-card space-y-1 rounded-lg border p-4">
      <p className="text-muted-foreground text-sm">{label}</p>
      <p
        className={cn(
          "text-2xl font-semibold tabular-nums",
          tone === "good" && "text-success",
          tone === "bad" && "text-destructive",
        )}
      >
        {value}
      </p>
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
}

/** Una cifra del resumen sin caja alrededor: se separan entre sí con una línea fina (el inicio del día). */
export function StatFigure({ label, value, hint, tone = "default" }: StatCardProps) {
  return (
    <div
      role="group"
      aria-label={label}
      className="border-divider space-y-1 lg:border-l lg:pl-5 lg:first:border-l-0 lg:first:pl-0"
    >
      <p className="text-muted-foreground text-sm">{label}</p>
      <p
        className={cn(
          "font-heading text-2xl font-semibold tabular-nums",
          tone === "good" && "text-success",
          tone === "bad" && "text-destructive",
        )}
      >
        {value}
      </p>
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
}
