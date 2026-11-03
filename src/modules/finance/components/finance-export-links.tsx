import { Download } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { messages } from "@/config/messages.es";
import type { FinanceExportKind } from "@/modules/finance/export";

const copy = messages.reports.export;

type FinanceExportLinksProps = {
  kind: FinanceExportKind;
  /** Los mismos filtros de la pantalla: `rango`, `desde`, `hasta`, `tipo`… */
  params: Record<string, string | undefined>;
};

/** Los botones para llevarse el resumen o los movimientos a Excel o CSV con los filtros que se están viendo. */
export function FinanceExportLinks({ kind, params }: FinanceExportLinksProps) {
  const href = (format: "xlsx" | "csv") => {
    const query = new URLSearchParams();
    for (const [name, value] of Object.entries(params)) {
      if (value) {
        query.set(name, value);
      }
    }
    query.set("formato", format);
    return `/api/finanzas/${kind}/exportar?${query.toString()}`;
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
