import { cn } from "@/lib/utils";

/** Bloque de carga: gris suave con un brillo rosa que lo recorre (en lugar de un parpadeo). */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "bg-muted relative overflow-hidden rounded-md",
        "after:animate-shimmer after:via-primary/10 after:absolute after:inset-0 after:-translate-x-full after:bg-linear-to-r after:from-transparent after:to-transparent",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
