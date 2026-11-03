import { cn } from "@/lib/utils";

/** Iniciales para el círculo del usuario: primera letra del primer y del último nombre («Ana Pérez Mora» → «AM»). */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0];
  if (!first) {
    return "?";
  }
  const last = words.length > 1 ? words[words.length - 1]?.[0] : undefined;
  return `${first}${last ?? ""}`.toUpperCase();
}

/** Círculo con las iniciales de quien tiene la sesión abierta. El nombre completo va siempre al lado, así que no se lee dos veces. */
export function UserAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "bg-secondary text-secondary-foreground grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold",
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}
