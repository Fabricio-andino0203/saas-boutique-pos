import { LoaderCircle } from "lucide-react";

import { cn } from "@/lib/utils";

/** Indicador de espera: lo usan los botones (`loading`) y cualquier lugar que espere una respuesta. */
export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle aria-hidden="true" className={cn("size-4 animate-spin", className)} />;
}
