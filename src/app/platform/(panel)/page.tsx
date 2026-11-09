import { Building2, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { buttonVariants } from "@/components/ui/button";
import { platformMessages } from "@/config/messages.platform.es";
import { formatLocalDate, formatLocalDateTime } from "@/lib/dates";
import { requirePlatformSession } from "@/lib/platform-auth";
import { tenantPoolStats } from "@/lib/tenancy/tenant-clients";
import { describeAlert } from "@/modules/platform/alert-text";
import { collectAlerts } from "@/modules/platform/alerts";
import { billingOverview } from "@/modules/platform/billing";
import { getPlatformSummary } from "@/modules/platform/queries";

const copy = platformMessages.summary;
const billing = platformMessages.billing;
const alertsCopy = platformMessages.alerts;

export default async function PlatformSummaryPage() {
  const { user } = await requirePlatformSession();
  const [summary, overview, alerts] = await Promise.all([
    getPlatformSummary(),
    billingOverview(),
    collectAlerts(),
  ]);
  const pool = tenantPoolStats();

  return (
    <div className="space-y-8">
      <PageHeader title={copy.title} />

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

      <section aria-label={copy.pool.label} data-testid="pool-card">
        <StatCard
          label={copy.pool.label}
          value={copy.pool.of
            .replace("{active}", String(pool.active))
            .replace("{capacity}", String(pool.capacity))}
          hint={`${copy.pool.hint
            .replace("{max}", String(pool.maxConnections))
            .replace("{waited}", String(pool.waited))
            .replace(
              "{timedOut}",
              String(pool.timedOut),
            )}${pool.timedOut > 0 ? ` ${copy.pool.saturated}` : ""}`}
        />
      </section>

      <section className="space-y-3" aria-labelledby="alerts-title" data-testid="platform-alerts">
        <h2 id="alerts-title" className="text-lg font-semibold">
          {alertsCopy.title}
        </h2>
        {alerts.length === 0 ? (
          <p className="text-muted-foreground text-sm">{alertsCopy.none}</p>
        ) : (
          <ul className="border-divider divide-divider divide-y rounded-lg border">
            {alerts.map((alert, index) => {
              const { text, href } = describeAlert(alert);
              return (
                <li
                  key={`${alert.code}-${alert.slug ?? index}-${alert.detail ?? ""}`}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
                  data-severity={alert.severity}
                >
                  <Link href={href} className="text-primary font-medium underline">
                    {text}
                  </Link>
                  <span
                    className={
                      alert.severity === "critical"
                        ? "text-destructive font-medium"
                        : "text-muted-foreground"
                    }
                  >
                    {alertsCopy.severity[alert.severity]}
                  </span>
                </li>
              );
            })}
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
      {hint ? <p className="text-muted-foreground text-sm">{hint}</p> : null}
    </div>
  );
}
