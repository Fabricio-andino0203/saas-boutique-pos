import Link from "next/link";
import { notFound } from "next/navigation";

import { PrintButton } from "@/components/shared/print-button";
import { buttonVariants } from "@/components/ui/button";
import { messages } from "@/config/messages.es";
import { requirePageCapability } from "@/lib/auth";
import { LayawayReceiptSheet } from "@/modules/layaways/components/layaway-receipt";
import { getLayawayReceipt } from "@/modules/layaways/queries";
import { AutoPrint } from "@/modules/sales/components/auto-print";

export default async function PrintLayawayReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ auto?: string }>;
}) {
  await requirePageCapability("layaway.manage");
  const { id } = await params;
  const doc = await getLayawayReceipt(id);
  if (!doc) {
    notFound();
  }
  const auto = (await searchParams).auto === "1";
  const copy = messages.layaways.receipt;

  return (
    <main className="bg-white p-4 text-black print:p-0">
      <style>{`@media print { .no-print { display: none !important; } }`}</style>
      <div className="no-print mx-auto mb-4 flex max-w-sm flex-wrap items-center gap-3">
        <Link
          href={`/apartados/${doc.layaway.id}`}
          className={buttonVariants({ variant: "outline" })}
        >
          {copy.back}
        </Link>
        <PrintButton label={copy.print} />
      </div>
      {auto ? <AutoPrint /> : null}
      <LayawayReceiptSheet doc={doc} />
    </main>
  );
}
