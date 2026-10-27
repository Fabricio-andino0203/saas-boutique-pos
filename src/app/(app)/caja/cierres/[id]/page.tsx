import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shared/page-header";
import { buttonVariants } from "@/components/ui/button";
import { messages } from "@/config/messages.es";
import { requirePageCapability } from "@/lib/auth";
import { formatLocalDateTime } from "@/lib/dates";
import { hasCapability } from "@/lib/permissions";
import { ApproveCashButton } from "@/modules/cash/components/approve-cash-button";
import { CashSessionSummary } from "@/modules/cash/components/cash-session-summary";
import { getCashSessionDetail } from "@/modules/cash/queries";

export default async function CashClosingPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requirePageCapability("cash.open");
  const { id } = await params;
  const detail = await getCashSessionDetail(id);
  // Quien no puede ver las cajas de otros solo abre las suyas; lo demás "no existe" para esa persona.
  if (
    !detail ||
    (detail.session.userId !== user.id && !hasCapability(user.role, "cash.viewOthers"))
  ) {
    notFound();
  }
  const copy = messages.cash;
  const pending = detail.session.status === "CLOSED_PENDING_APPROVAL";
  const canApprove = hasCapability(user.role, "cash.closeApprove");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title={copy.detail.title}
        description={formatLocalDateTime(detail.session.openedAt)}
        actions={
          <>
            <Link href="/caja/cierres" className={buttonVariants({ variant: "outline" })}>
              {copy.list.back}
            </Link>
            <Link
              href={`/imprimir/cierre/${detail.session.id}`}
              className={buttonVariants({ variant: "outline" })}
            >
              {copy.detail.print}
            </Link>
          </>
        }
      />
      {pending ? (
        <section className="bg-warning/10 space-y-2 rounded-lg border p-4">
          {canApprove ? (
            <ApproveCashButton sessionId={detail.session.id} />
          ) : (
            <p className="text-sm">{copy.approve.needManager}</p>
          )}
        </section>
      ) : null}
      <CashSessionSummary detail={detail} />
    </div>
  );
}
