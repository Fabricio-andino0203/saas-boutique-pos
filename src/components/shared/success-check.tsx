import { cn } from "@/lib/utils";

/** Marca de éxito animada (círculo que aparece y check que se dibuja). La usa la pantalla de «venta cobrada». */
export function SuccessCheck({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 56 56"
      aria-hidden="true"
      className={cn("animate-check-pop size-14", className)}
    >
      <circle cx="28" cy="28" r="26" strokeWidth="2" className="fill-success/15 stroke-success" />
      <path
        d="M17 29.5l7.5 7.5L39 21"
        fill="none"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="34"
        className="stroke-success animate-check-draw"
      />
    </svg>
  );
}
