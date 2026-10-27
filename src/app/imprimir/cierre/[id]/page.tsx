import Link from "next/link";
import { notFound } from "next/navigation";

import { PrintButton } from "@/components/shared/print-button";
import { buttonVariants } from "@/components/ui/button";
import { messages } from "@/config/messages.es";
import { requirePageCapability } from "@/lib/auth";
import { formatLocalDateTime } from "@/lib/dates";
import { hasCapability } from "@/lib/permissions";
import { CashSessionSummary } from "@/modules/cash/components/cash-session-summary";
import { getCashSessionDetail } from "@/modules/cash/queries";

export default async function PrintCashClosingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { user } = await requirePageCapability("cash.open");
  const { id } = await params;
  const detail = await getCashSessionDetail(id);
  if (
    !detail ||
    (detail.session.userId !== user.id && !hasCapability(user.role, "cash.viewOthers"))
  ) {
    notFound();
  }
  const copy = messages.cash.print;

  return (
    <main className="bg-white p-6 text-black print:p-0">
      <style>{`@page { size: A4; margin: 12mm; } @media print { .no-print { display: none !important; } body { background: #fff; } }`}</style>
      <div className="no-print mx-auto mb-6 flex max-w-3xl flex-wrap items-center gap-3">
        <Link
          href={`/caja/cierres/${detail.session.id}`}
          className={buttonVariants({ variant: "outline" })}
        >
          {messages.cash.detail.back}
        </Link>
        <PrintButton label={copy.print} />
      </div>
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="space-y-1">
          <p className="text-sm">{messages.app.name}</p>
          <h1 className="text-2xl font-semibold">{copy.title}</h1>
        </header>
        <CashSessionSummary detail={detail} />
        <div className="grid grid-cols-2 gap-12 pt-16 text-sm">
          <p className="border-t border-black pt-1">{copy.signCashier}</p>
          <p className="border-t border-black pt-1">{copy.signManager}</p>
        </div>
        <p className="text-xs">
          {copy.printedAt}: {formatLocalDateTime(new Date())}
        </p>
      </div>
    </main>
  );
}
