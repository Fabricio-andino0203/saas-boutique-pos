import Link from "next/link";
import { notFound } from "next/navigation";

import { PrintButton } from "@/components/shared/print-button";
import { buttonVariants } from "@/components/ui/button";
import { messages } from "@/config/messages.es";
import { requirePageCapability } from "@/lib/auth";
import { AutoPrint } from "@/modules/sales/components/auto-print";
import { ReturnDocumentSheet } from "@/modules/returns/components/return-document";
import { getReturnDocument } from "@/modules/returns/queries";

export default async function PrintReturnPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ auto?: string }>;
}) {
  await requirePageCapability("return.create");
  const { id } = await params;
  const doc = await getReturnDocument(id);
  if (!doc) {
    notFound();
  }
  const auto = (await searchParams).auto === "1";
  const copy = messages.returns.doc;

  return (
    <main className="bg-white p-4 text-black print:p-0">
      <style>{`@media print { .no-print { display: none !important; } }`}</style>
      <div className="no-print mx-auto mb-4 flex max-w-sm flex-wrap items-center gap-3">
        <Link href="/devoluciones" className={buttonVariants({ variant: "outline" })}>
          {copy.back}
        </Link>
        <PrintButton label={copy.print} />
      </div>
      {auto ? <AutoPrint /> : null}
      <ReturnDocumentSheet doc={doc} />
    </main>
  );
}
