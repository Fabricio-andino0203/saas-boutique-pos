import type { ReactNode } from "react";

import { platformMessages } from "@/config/messages.platform.es";
import { formatLocalDateTime } from "@/lib/dates";
import { BACKED_UP_STATUSES } from "@/modules/platform/backups";
import { RefreshUsageForm } from "@/modules/platform/components/retired-forms";
import { getTenantUsage, nearLimit } from "@/modules/platform/usage";

const copy = platformMessages.usage;

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

/** Cuánto usa un negocio la plataforma: solo cuentas y fechas, contra los topes de su plan. */
export async function TenantUsage({
  id,
  slug,
  tenantStatus,
}: {
  id: string;
  slug: string;
  tenantStatus: string;
}) {
  if (!(BACKED_UP_STATUSES as string[]).includes(tenantStatus)) {
    return null;
  }
  const usage = await getTenantUsage(id);
  const ofLimit = (used: number, limit: number | null) =>
    limit === null
      ? String(used)
      : copy.of.replace("{used}", String(used)).replace("{limit}", String(limit));

  return (
    <section aria-labelledby="usage-title" className="space-y-3" data-testid="tenant-usage">
      <h2 id="usage-title" className="text-lg font-semibold">
        {copy.title}
      </h2>
      <p className="text-muted-foreground max-w-3xl text-sm">{copy.description}</p>
      {usage ? (
        <>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Fact label={copy.facts.users}>
              <span
                data-testid="usage-users"
                className={
                  nearLimit(usage.reading.activeUsers, usage.limits.users)
                    ? "text-destructive font-medium"
                    : ""
                }
              >
                {ofLimit(usage.reading.activeUsers, usage.limits.users)}
              </span>
            </Fact>
            <Fact label={copy.facts.products}>
              <span
                data-testid="usage-products"
                className={
                  nearLimit(usage.reading.products, usage.limits.products)
                    ? "text-destructive font-medium"
                    : ""
                }
              >
                {ofLimit(usage.reading.products, usage.limits.products)}
              </span>
            </Fact>
            <Fact label={copy.facts.sales}>{usage.reading.sales30d}</Fact>
            <Fact label={copy.facts.lastSale}>
              {usage.reading.lastSaleAt
                ? formatLocalDateTime(usage.reading.lastSaleAt)
                : copy.never}
            </Fact>
            <Fact label={copy.facts.lastLogin}>
              {usage.reading.lastLoginAt
                ? formatLocalDateTime(usage.reading.lastLoginAt)
                : copy.never}
            </Fact>
            <Fact label={copy.facts.size}>
              {copy.mb.replace("{n}", String(usage.reading.databaseMb))}
            </Fact>
          </dl>
          <p className="text-muted-foreground text-sm">
            {copy.takenAt} {formatLocalDateTime(usage.takenAt)}
          </p>
        </>
      ) : (
        <p className="text-muted-foreground text-sm" data-testid="usage-none">
          {copy.none}
        </p>
      )}
      <div className="max-w-3xl">
        <RefreshUsageForm slug={slug} />
      </div>
    </section>
  );
}
