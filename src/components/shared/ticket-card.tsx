import type { ReactNode } from "react";

type TicketCardProps = {
  /** Lo que se mira (arriba de la línea de corte). */
  top: ReactNode;
  /** Lo que se hace o se cobra (abajo de la línea de corte). */
  bottom: ReactNode;
  /** Nombre del grupo para lectores de pantalla. */
  label?: string;
  className?: string;
};

/**
 * Tarjeta con forma de boleto: muescas a los lados y una línea de corte punteada entre dos mitades. Cada mitad recorta sus
 * propias esquinas, así que la línea cae justo donde terminan los contenidos sin importar su altura. La forma vive en
 * `.ticket-top` y `.ticket-bottom` (globals.css).
 */
export function TicketCard({ top, bottom, label, className }: TicketCardProps) {
  return (
    <div role="group" aria-label={label} className={className}>
      <div className="ticket-top p-4 pb-5">{top}</div>
      <div className="ticket-bottom p-4 pt-5">{bottom}</div>
    </div>
  );
}
