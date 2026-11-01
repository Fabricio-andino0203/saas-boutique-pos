import { Building2, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { buttonVariants } from "@/components/ui/button";
import { platformMessages } from "@/config/messages.platform.es";
import { formatLocalDate, formatLocalDateTime } from "@/lib/dates";
import { requirePlatformSession } from "@/lib/platform-auth";
import { backupOverview } from "@/modules/platform/backups";
import { billingOverview } from "@/modules/platform/billing";
import { getPlatformSummary } from "@/modules/platform/queries";

const copy = platformMessages.summary;
const billing = platformMessages.billing;
const backups = platformMessages.backups;

export default async function PlatformSummaryPage() {
  const { user } = await requirePlatformSession();
  const [summary, overview, backupStatus] = await Promise.all([
    getPlatformSummary(),
    billingOverview(),
    backupOverview(),
  ]);

  return (
    <div className="space-y-8">
      <PageHeader title={copy.title} description={copy.description} />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label={copy.title}>
        <StatCard
          icon={<Building2 aria-hidden="true" className="size-5" />}
          label={copy.tenantsTotal}
          value={String(summary.tenantsTotal)}
          hint={copy.tenantsHint}
        />
        <StatCard
          icon={<ShieldCheck aria-hidden="true" className="size-5" />}
          label={copy.adminsActive}
          value={String(summary.activeAdmins)}
          hint={copy.adminsHint}
        />
        <StatCard
          label={copy.lastLogin}
          value={user.lastLoginAt ? formatLocalDateTime(user.lastLoginAt) : copy.never}
        />
        <StatCard
          label={`${copy.platform.vault} (${copy.platform.vaultVersion})`}
          value={String(summary.vaultKeyVersion)}
          hint={`${copy.platform.twoFactor}: ${user.twoFactorEnabled ? copy.platform.ok : "—"}`}
        />
      </section>

      <section
        className="space-y-3"
        aria-labelledby="backup-attention-title"
        data-testid="backup-attention"
      >
        <h2 id="backup-attention-title" className="text-lg font-semibold">
          {backups.attention.title}
        </h2>
        {backupStatus.attention.length === 0 ? (
          <p className="text-muted-foreground text-sm">{backups.attention.empty}</p>
        ) : (
          <ul className="border-divider divide-divider divide-y rounded-lg border">
            {backupStatus.attention.map((item) => (
              <li
                key={item.slug ?? "control"}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
              >
                {item.slug ? (
                  <Link
                    href={`/negocios/${item.slug}`}
                    className="text-primary font-medium underline"
                  >
                    {item.name}
                  </Link>
                ) : (
                  <Link href="/respaldos" className="text-primary font-medium underline">
                    {backups.attention.control}
                  </Link>
                )}
                <span className="text-destructive">{backups.states[item.state]}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        className="space-y-3"
        aria-labelledby="attention-title"
        data-testid="billing-attention"
      >
        <h2 id="attention-title" className="text-lg font-semibold">
          {billing.overview.title}
        </h2>
        {overview.attention.length === 0 ? (
          <p className="text-muted-foreground text-sm">{billing.overview.empty}</p>
        ) : (
          <ul className="border-divider divide-divider divide-y rounded-lg border">
            {overview.attention.map((row) => (
              <li
                key={row.slug}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
              >
                <Link href={`/negocios/${row.slug}`} className="text-primary font-medium underline">
                  {row.name}
                </Link>
                <span className="text-muted-foreground">
                  {row.plan} · {billing.modes[row.mode]} ·{" "}
                  {row.daysToPeriodEnd > 0
                    ? billing.overview.dueIn.replace("{n}", String(row.daysToPeriodEnd))
                    : row.daysToPeriodEnd === 0
                      ? billing.overview.dueToday
                      : billing.overview.overdue.replace("{n}", String(-row.daysToPeriodEnd))}{" "}
                  ({formatLocalDate(row.periodEnd)})
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{copy.recent}</h2>
          <Link href="/auditoria" className={buttonVariants({ variant: "outline", size: "sm" })}>
            {copy.viewAll}
          </Link>
        </div>
        {summary.recent.length === 0 ? (
          <p className="text-muted-foreground text-sm">{copy.recentEmpty}</p>
        ) : (
          <ul className="border-divider divide-divider divide-y rounded-lg border">
            {summary.recent.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
              >
                <span>
                  <span className="font-medium">
                    {(platformMessages.audit.actions as Record<string, string>)[row.action] ??
                      row.action}
                  </span>
                  <span className="text-muted-foreground">
                    {" · "}
                    {row.actorUsername ? `@${row.actorUsername}` : platformMessages.audit.system}
                  </span>
                </span>
                <time className="text-muted-foreground" dateTime={row.at.toISOString()}>
                  {formatLocalDateTime(row.at)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  hint,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="border-divider bg-card space-y-1 rounded-xl border p-5">
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        {icon}
        {label}
      </div>
      <p className="text-2xl font-semibold tracking-tight">{value}</p>
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
}
