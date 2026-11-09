import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shared/page-header";
import { platformMessages } from "@/config/messages.platform.es";
import { formatLocalDateTime } from "@/lib/dates";
import { requirePlatformSession } from "@/lib/platform-auth";
import { TenantActions } from "@/modules/platform/components/tenant-actions";
import { TenantBackups } from "@/modules/platform/components/tenant-backups";
import { TenantSubscription } from "@/modules/platform/components/tenant-subscription";
import { TenantSupport } from "@/modules/platform/components/tenant-support";
import { TenantUsage } from "@/modules/platform/components/tenant-usage";
import { getTenantDetail } from "@/modules/platform/queries";

const copy = platformMessages.tenants;
const detail = copy.detail;

type Props = { params: Promise<{ slug: string }> };

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

export default async function PlatformTenantDetailPage({ params }: Props) {
  const { user } = await requirePlatformSession();
  const { slug } = await params;
  const tenant = await getTenantDetail(slug);
  if (!tenant) {
    notFound();
  }
  const baseDomain = process.env.TENANT_BASE_DOMAIN;
  const latestRun = tenant.runs[0];
  const hasUnfinishedRun =
    latestRun !== undefined && ["FAILED", "RUNNING"].includes(latestRun.status);
  const retentionOver = tenant.deleteAfter ? tenant.deleteAfter <= new Date() : false;

  return (
    <div className="space-y-8">
      <PageHeader
        title={tenant.name}
        description={copy.status[tenant.status]}
        actions={
          <Link href="/negocios" className="text-primary text-sm underline">
            {detail.back}
          </Link>
        }
      />

      {tenant.status === "MIGRATION_FAILED" ? (
        <div role="alert" className="border-destructive/40 space-y-1 rounded-md border p-4">
          <p className="font-medium">{detail.migrationFailed}</p>
          <p className="text-muted-foreground text-sm">{detail.migrationFailedHelp}</p>
          {tenant.migrationError ? (
            <pre className="bg-muted overflow-x-auto rounded p-2 text-xs whitespace-pre-wrap">
              {tenant.migrationError}
            </pre>
          ) : null}
        </div>
      ) : null}

      {tenant.status === "PENDING_DELETION" && tenant.deleteAfter ? (
        <div role="status" className="space-y-1 rounded-md border p-4">
          <p className="font-medium">{detail.pendingDeletion}</p>
          <p className="text-sm">
            {detail.pendingDeletionHelp} {formatLocalDateTime(tenant.deleteAfter)}.
          </p>
          {tenant.deletionReason ? (
            <p className="text-muted-foreground text-sm">
              {detail.reason}: {tenant.deletionReason}
            </p>
          ) : null}
        </div>
      ) : null}

      {tenant.status === "DELETED" ? (
        <div role="status" className="space-y-1 rounded-md border p-4">
          <p className="font-medium">{detail.archived}</p>
          <p className="text-sm">{detail.archivedHelp}</p>
          {tenant.archivedDbName ? (
            <p className="font-mono text-xs">{tenant.archivedDbName}</p>
          ) : null}
        </div>
      ) : null}

      <section aria-labelledby="facts-title" className="space-y-3">
        <h2 id="facts-title" className="text-lg font-semibold">
          {detail.facts}
        </h2>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Fact label={detail.address}>
            {baseDomain ? `${tenant.slug}.${baseDomain}` : tenant.slug}
          </Fact>
          <Fact label={copy.columns.status}>{copy.status[tenant.status]}</Fact>
          <Fact label={copy.columns.schema}>
            <span className="font-mono text-xs break-all">
              {tenant.schemaVersion ?? detail.none}
            </span>
          </Fact>
          <Fact label={detail.owner}>{tenant.ownerEmail ?? detail.none}</Fact>
          <Fact label={detail.database}>
            <span className="font-mono text-xs">{tenant.dbName ?? detail.none}</span>
          </Fact>
          <Fact label={detail.canary}>{tenant.canary ? detail.yes : detail.no}</Fact>
          <Fact label={copy.columns.created}>{formatLocalDateTime(tenant.createdAt)}</Fact>
        </dl>
      </section>

      <TenantSubscription slug={tenant.slug} tenantStatus={tenant.status} />

      <TenantUsage id={tenant.id} slug={tenant.slug} tenantStatus={tenant.status} />

      <TenantBackups
        id={tenant.id}
        slug={tenant.slug}
        tenantStatus={tenant.status}
        createdAt={tenant.createdAt}
        database={tenant.dbName}
      />

      <TenantSupport
        id={tenant.id}
        slug={tenant.slug}
        tenantStatus={tenant.status}
        adminId={user.id}
      />

      <TenantActions
        slug={tenant.slug}
        status={tenant.status}
        canary={tenant.canary}
        hasUnfinishedRun={hasUnfinishedRun}
        retentionOver={retentionOver}
      />

      <section aria-labelledby="runs-title" className="space-y-3">
        <h2 id="runs-title" className="text-lg font-semibold">
          {detail.runs}
        </h2>
        {tenant.runs.length === 0 ? (
          <p className="text-muted-foreground text-sm">{detail.noRuns}</p>
        ) : (
          tenant.runs.map((run) => (
            <div key={run.id} className="space-y-2 rounded-md border p-4">
              <p className="text-sm font-medium">
                {detail.runColumns.attempt} {run.attempt} — {detail.runStatus[run.status]}
              </p>
              <ol className="space-y-1 text-sm">
                {run.steps.map((step) => (
                  <li key={step.name} className="flex flex-wrap gap-2">
                    <span className="w-24 shrink-0 text-xs">{detail.stepStatus[step.status]}</span>
                    <span>{detail.steps[step.name as keyof typeof detail.steps] ?? step.name}</span>
                    {step.error ? (
                      <span className="text-destructive text-xs">{step.error}</span>
                    ) : null}
                  </li>
                ))}
              </ol>
              <p className="text-muted-foreground text-sm">
                {detail.runColumns.started}: {formatLocalDateTime(run.startedAt)}
                {run.finishedAt
                  ? ` · ${detail.runColumns.finished}: ${formatLocalDateTime(run.finishedAt)}`
                  : ""}
              </p>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
