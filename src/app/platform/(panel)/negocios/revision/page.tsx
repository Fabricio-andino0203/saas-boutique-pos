import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { platformMessages } from "@/config/messages.platform.es";
import { requirePlatformSession } from "@/lib/platform-auth";
import { MigrateFleetForm } from "@/modules/platform/components/migrate-fleet-form";
import { provisioningAvailable } from "@/modules/platform/provisioning";
import { reconcileTenants } from "@/modules/platform/reconcile";

const copy = platformMessages.tenants.review;

function Section({ title, lines }: { title: string; lines: string[] }) {
  if (lines.length === 0) {
    return null;
  }
  return (
    <section className="space-y-1">
      <h2 className="text-base font-semibold">{title}</h2>
      <ul className="list-inside list-disc text-sm">
        {lines.map((line) => (
          <li key={line} className="font-mono text-xs">
            {line}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function PlatformReviewPage() {
  await requirePlatformSession();
  const available = provisioningAvailable();
  const report = available ? await reconcileTenants() : undefined;

  return (
    <div className="space-y-10">
      <PageHeader
        title={copy.title}
        description={copy.description}
        actions={
          <Link href="/negocios" className="text-primary text-sm underline">
            {platformMessages.tenants.detail.back}
          </Link>
        }
      />

      {report ? (
        <div className="space-y-6">
          {report.ok ? (
            <p role="status" className="text-sm text-green-700 dark:text-green-400">
              {copy.ok}
            </p>
          ) : null}
          <Section title={copy.sections.orphanDatabases} lines={report.orphanDatabases} />
          <Section title={copy.sections.orphanRoles} lines={report.orphanRoles} />
          <Section title={copy.sections.replacedDatabases} lines={report.replacedDatabases} />
          <Section
            title={copy.sections.missingDatabases}
            lines={report.missingDatabases.map((item) => `${item.slug} (${item.database})`)}
          />
          <Section
            title={copy.sections.missingArchives}
            lines={report.missingArchives.map((item) => `${item.slug} (${item.database})`)}
          />
          <Section
            title={copy.sections.staleRuns}
            lines={report.staleRuns.map((item) => item.slug)}
          />
          <Section
            title={copy.sections.behind}
            lines={report.behind.map((item) => `${item.slug}: ${item.schemaVersion ?? "—"}`)}
          />
        </div>
      ) : (
        <p role="status" className="text-muted-foreground text-sm">
          {copy.unavailable}
        </p>
      )}

      {available ? (
        <section aria-labelledby="migrate-all-title" className="space-y-3">
          <h2 id="migrate-all-title" className="text-lg font-semibold">
            {copy.migrateAll.title}
          </h2>
          <p className="text-muted-foreground max-w-3xl text-sm">{copy.migrateAll.description}</p>
          <MigrateFleetForm />
        </section>
      ) : null}
    </div>
  );
}
