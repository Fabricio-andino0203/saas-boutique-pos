import { Layers } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { platformMessages } from "@/config/messages.platform.es";
import { PLAN_LIMIT_KINDS } from "@/config/plan-catalog";
import { formatMoney } from "@/lib/format";
import { requirePlatformSession } from "@/lib/platform-auth";
import { parseLimits } from "@/lib/tenancy/billing";
import { listPlans } from "@/modules/platform/billing";

const copy = platformMessages.billing;
const plansCopy = copy.plans;

export default async function PlatformPlansPage() {
  await requirePlatformSession();
  const plans = await listPlans();

  return (
    <div className="space-y-8">
      <PageHeader
        title={plansCopy.title}
        description={plansCopy.description}
        actions={
          <Link href="/planes/nuevo" className={buttonVariants()}>
            {plansCopy.new}
          </Link>
        }
      />

      {plans.length === 0 ? (
        <EmptyState
          icon={Layers}
          title={plansCopy.empty.title}
          description={plansCopy.empty.description}
        />
      ) : (
        <Table>
          <TableCaption className="sr-only">{plansCopy.title}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{plansCopy.columns.name}</TableHead>
              <TableHead>{plansCopy.columns.price}</TableHead>
              <TableHead>{plansCopy.columns.limits}</TableHead>
              <TableHead>{plansCopy.columns.modules}</TableHead>
              <TableHead>{plansCopy.columns.trial}</TableHead>
              <TableHead>{plansCopy.columns.state}</TableHead>
              <TableHead>{plansCopy.columns.businesses}</TableHead>
              <TableHead>
                <span className="sr-only">{plansCopy.edit}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {plans.map((plan) => {
              const limits = parseLimits(plan.limits);
              return (
                <TableRow key={plan.id} data-testid={`plan-row-${plan.name}`}>
                  <TableCell className="font-medium">{plan.name}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatMoney(plan.priceCents)} · {copy.intervals[plan.interval]}
                  </TableCell>
                  <TableCell className="text-xs">
                    {PLAN_LIMIT_KINDS.filter((kind) => kind === "users" || kind === "products").map(
                      (kind) => (
                        <div key={kind}>
                          {copy.limitLabels[kind]}: {limits[kind] ?? copy.unlimited}
                        </div>
                      ),
                    )}
                  </TableCell>
                  <TableCell className="max-w-64 text-xs">
                    {plan.features.length === 0
                      ? "—"
                      : plan.features
                          .map(
                            (feature) =>
                              copy.features[feature as keyof typeof copy.features] ?? feature,
                          )
                          .join(", ")}
                  </TableCell>
                  <TableCell>
                    {plan.trialDays === 0
                      ? plansCopy.noTrial
                      : plansCopy.days.replace("{n}", String(plan.trialDays))}
                  </TableCell>
                  <TableCell>{plan.isActive ? plansCopy.active : plansCopy.inactive}</TableCell>
                  <TableCell>{plan.activeSubscriptions}</TableCell>
                  <TableCell>
                    <Link
                      href={`/planes/${plan.id}`}
                      className="text-primary text-sm underline"
                      aria-label={`${plansCopy.edit} ${plan.name}`}
                    >
                      {plansCopy.edit}
                    </Link>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
