import { messages } from "@/config/messages.es";
import { cn } from "@/lib/utils";

/**
 * Cuadro rosa con la bolsa y la «B» del kit de marca de Andino Software. La «B» (Poppins Bold) va convertida a trazos para que
 * el icono no dependa de ninguna fuente; los colores son los de la marca y se ven igual en claro y en oscuro.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 1024 1024" aria-hidden="true" className={cn("size-9 shrink-0", className)}>
      <rect width="1024" height="1024" rx="176" fill="#F43F78" />
      <path
        d="M420 378v-36a92 92 0 0 1 184 0v36"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="26"
        strokeLinecap="round"
      />
      <path
        d="M370 370h284c17 0 29 12 32 29l39 276c3 22-12 39-34 39H333c-22 0-37-17-34-39l39-276c3-17 15-29 32-29z"
        fill="#FFFFFF"
      />
      <path
        d="M657 390l31 284c2 17-8 30-25 35l-8 3 40-1c22 0 37-17 34-39l-39-276c-3-17-15-29-32-29z"
        fill="#FBC3D2"
        opacity=".85"
      />
      <path
        d="M556.9 532.4Q574.3 536.1 584.8 549.6Q595.4 563.2 595.4 580.6L595.4 580.6Q595.4 605.6 577.8 620.3Q560.3 635 529.0 635L529.0 635L435.8 635L435.8 434.9L525.8 434.9Q556.3 434.9 573.6 448.9Q590.8 462.9 590.8 486.8L590.8 486.8Q590.8 504.5 581.5 516.2Q572.3 527.8 556.9 532.4L556.9 532.4ZM484.5 474.0L484.5 515.9L516.4 515.9Q528.4 515.9 534.8 510.6Q541.2 505.3 541.2 495.1L541.2 495.1Q541.2 484.8 534.8 479.4Q528.4 474.0 516.4 474.0L516.4 474.0L484.5 474.0ZM520.4 595.7Q532.7 595.7 539.4 590.1Q546.1 584.6 546.1 574.0L546.1 574.0Q546.1 563.5 539.1 557.5Q532.1 551.5 519.8 551.5L519.8 551.5L484.5 551.5L484.5 595.7L520.4 595.7Z"
        fill="#F43F78"
      />
    </svg>
  );
}

type BrandLogoProps = {
  /** `inline`: icono a la izquierda (menú lateral). `stacked`: icono arriba y centrado (pantallas de acceso). */
  variant?: "inline" | "stacked";
  /** Línea pequeña bajo el nombre; por defecto la firma de Andino Software. */
  caption?: string;
  className?: string;
};

/** Logotipo del kit: BOUTIQUE en ciruela, VENTAS en rosa con letras espaciadas y la firma debajo. */
export function BrandLogo({
  variant = "inline",
  caption = messages.app.maker,
  className,
}: BrandLogoProps) {
  const stacked = variant === "stacked";
  const [top, ...rest] = messages.app.name.split(" ");

  return (
    <span
      className={cn(
        "flex items-center gap-2.5",
        stacked && "flex-col gap-3 text-center",
        className,
      )}
    >
      <BrandMark className={stacked ? "size-16" : "size-9"} />
      <span className={cn("flex flex-col leading-none", stacked && "items-center")}>
        <span
          className={cn(
            "font-heading text-heading font-extrabold tracking-tight uppercase",
            stacked ? "text-2xl" : "text-base",
          )}
        >
          {top}
        </span>
        <span
          className={cn(
            "font-heading text-brand mt-1 font-bold uppercase",
            stacked ? "text-sm tracking-[0.32em]" : "text-xs tracking-[0.3em]",
          )}
        >
          {rest.join(" ")}
        </span>
        <span className={cn("text-muted-foreground mt-1.5", stacked ? "text-xs" : "text-[11px]")}>
          {caption}
        </span>
      </span>
    </span>
  );
}
