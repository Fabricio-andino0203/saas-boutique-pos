import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shared/page-header";
import { platformMessages } from "@/config/messages.platform.es";
import { formatMoneyPlain } from "@/lib/format";
import { requirePlatformSession } from "@/lib/platform-auth";
import { parseLimits } from "@/lib/tenancy/billing";
import { getPlan } from "@/modules/platform/billing";
import { PlanForm } from "@/modules/platform/components/plan-form";

const copy = platformMessages.billing.plans;

type Props = { params: Promise<{ id: string }> };

export default async function PlatformEditPlanPage({ params }: Props) {
  await requirePlatformSession();
  const { id } = await params;
  const plan = await getPlan(id);
  if (!plan) {
    notFound();
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title={`${copy.editTitle}: ${plan.name}`}
        actions={
          <Link href="/planes" className="text-primary text-sm underline">
            {copy.back}
          </Link>
        }
      />
      <PlanForm
        defaults={{
          id: plan.id,
          name: plan.name,
          description: plan.description ?? "",
          price: formatMoneyPlain(plan.priceCents),
          interval: plan.interval,
          trialDays: plan.trialDays,
          sortOrder: plan.sortOrder,
          isActive: plan.isActive,
          limits: parseLimits(plan.limits),
          features: plan.features,
        }}
      />
    </div>
  );
}
