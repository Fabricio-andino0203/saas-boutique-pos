import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
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
import { formatLocalDateTime } from "@/lib/dates";
import { requirePlatformSession } from "@/lib/platform-auth";
import { backupOverview, type BackupState } from "@/modules/platform/backups";
import { RequestControlBackupForm } from "@/modules/platform/components/backup-forms";
import { RetiredDatabases } from "@/modules/platform/components/retired-databases";

const copy = platformMessages.backups;

/** Los estados que piden atención se marcan con color y con texto (no solo con color). */
function StateTag({ state }: { state: BackupState }) {
  const problem = state === "stale" || state === "failed" || state === "never";
  return (
    <span
      data-state={state}
      className={
        problem ? "text-destructive font-medium" : state === "ok" ? "" : "text-muted-foreground"
      }
    >
      {copy.states[state]}
    </span>
  );
}

export default async function PlatformBackupsPage() {
  await requirePlatformSession();
  const overview = await backupOverview();

  return (
    <div className="space-y-8">
      <PageHeader title={copy.title} description={copy.description} />

      <Table data-testid="backup-overview">
        <TableCaption className="sr-only">{copy.title}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>{copy.columns.tenant}</TableHead>
            <TableHead>{copy.columns.state}</TableHead>
            <TableHead>{copy.columns.lastOk}</TableHead>
            <TableHead>{copy.columns.retention}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow data-testid="backup-row-control">
            <TableCell className="font-medium">
              {copy.control}
              <span className="text-muted-foreground block text-xs font-normal">
                {copy.controlHint}
              </span>
            </TableCell>
            <TableCell>
              <StateTag state={overview.control.state} />
              {overview.control.open ? (
                <span className="text-muted-foreground block text-xs">{copy.open}</span>
              ) : null}
            </TableCell>
            <TableCell className="whitespace-nowrap">
              {overview.control.lastOkAt
                ? formatLocalDateTime(overview.control.lastOkAt)
                : copy.never}
            </TableCell>
            <TableCell>—</TableCell>
          </TableRow>
          {overview.tenants.map((row) => (
            <TableRow key={row.slug} data-testid={`backup-row-${row.slug}`}>
              <TableCell className="font-medium">
                <Link href={`/negocios/${row.slug}`} className="text-primary underline">
                  {row.name}
                </Link>
              </TableCell>
              <TableCell>
                <StateTag state={row.state} />
                {row.open ? (
                  <span className="text-muted-foreground block text-xs">{copy.open}</span>
                ) : null}
              </TableCell>
              <TableCell className="whitespace-nowrap">
                {row.lastOkAt ? formatLocalDateTime(row.lastOkAt) : copy.never}
              </TableCell>
              <TableCell>
                {(row.retentionFromPlan ? copy.days : copy.daysServer).replace(
                  "{n}",
                  String(row.retentionDays),
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {overview.tenants.length === 0 ? (
        <p className="text-muted-foreground text-sm">{copy.empty}</p>
      ) : null}

      <div className="max-w-3xl">
        <RequestControlBackupForm />
      </div>

      <RetiredDatabases />
    </div>
  );
}
