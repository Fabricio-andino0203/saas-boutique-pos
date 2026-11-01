import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { platformMessages } from "@/config/messages.platform.es";
import { requirePlatformSession } from "@/lib/platform-auth";
import { PlanForm } from "@/modules/platform/components/plan-form";

const copy = platformMessages.billing.plans;

export default async function PlatformNewPlanPage() {
  await requirePlatformSession();

  return (
    <div className="space-y-8">
      <PageHeader
        title={copy.newTitle}
        actions={
          <Link href="/planes" className="text-primary text-sm underline">
            {copy.back}
          </Link>
        }
      />
      <PlanForm />
    </div>
  );
}
