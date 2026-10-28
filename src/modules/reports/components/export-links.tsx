import { Download } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { messages } from "@/config/messages.es";
import type { ExportKind } from "@/modules/reports/export";

const copy = messages.reports.export;

type ExportLinksProps = {
  kind: ExportKind;
  /** Los mismos filtros de la pantalla: `rango`, `desde`, `hasta`, `por`… */
  params: Record<string, string | undefined>;
};

/** Los botones para llevarse el reporte a Excel o CSV con los filtros que se están viendo. */
export function ExportLinks({ kind, params }: ExportLinksProps) {
  const href = (format: "xlsx" | "csv") => {
    const query = new URLSearchParams();
    for (const [name, value] of Object.entries(params)) {
      if (value) {
        query.set(name, value);
      }
    }
    query.set("formato", format);
    return `/api/reportes/${kind}/exportar?${query.toString()}`;
  };
  return (
    <div role="group" aria-label={copy.title} className="flex flex-wrap items-center gap-2">
      <a
        href={href("xlsx")}
        download
        className={buttonVariants({ variant: "outline", size: "sm" })}
      >
        <Download aria-hidden="true" />
        {copy.excel}
      </a>
      <a href={href("csv")} download className={buttonVariants({ variant: "ghost", size: "sm" })}>
        {copy.csv}
      </a>
    </div>
  );
}
