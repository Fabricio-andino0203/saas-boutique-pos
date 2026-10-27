import Link from "next/link";
import { notFound } from "next/navigation";

import { PrintButton } from "@/components/shared/print-button";
import { buttonVariants } from "@/components/ui/button";
import { messages } from "@/config/messages.es";
import { requirePageCapability } from "@/lib/auth";
import { AutoPrint } from "@/modules/sales/components/auto-print";
import { TicketDocument } from "@/modules/sales/components/ticket-document";
import { getSaleDocument } from "@/modules/sales/queries";

export default async function PrintTicketPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ auto?: string }>;
}) {
  await requirePageCapability("sale.create");
  const { id } = await params;
  const doc = await getSaleDocument(id);
  if (!doc) {
    notFound();
  }
  const auto = (await searchParams).auto === "1";
  const copy = messages.salesDoc;

  return (
    <main className="bg-white p-4 text-black print:p-0">
      <style>{`@media print { .no-print { display: none !important; } }`}</style>
      <div className="no-print mx-auto mb-4 flex max-w-sm flex-wrap items-center gap-3">
        <Link href="/vender" className={buttonVariants({ variant: "outline" })}>
          {copy.back}
        </Link>
        <PrintButton label={copy.print} />
      </div>
      {auto ? <AutoPrint /> : null}
      <TicketDocument doc={doc} />
    </main>
  );
}
